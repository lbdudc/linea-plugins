# 03 — MCP architecture

## Scope

The MCP server is bound to **one specific SPL**. It does not let the caller
create or list SPLs, switch between SPLs, or impersonate users. Everything the
MCP does is scoped to:

- a fixed GitLab installation (`GITLAB_URL`),
- a fixed GitLab identity (a personal access token or service-account token),
- a fixed SPL identified at startup.

## Two implementation options

### Option A — HTTP proxy MCP (recommended)

The MCP process is thin: each tool maps to one or two SPLALM REST calls and
re-shapes the response.

```
MCP client (assistant) ──► MCP server ──► SPLALM REST API ──► MongoDB + GitLab
```

Pros:
- All business logic, transactions, GitLab orchestration, and permission
  checks are reused as-is.
- No need to re-implement the `spl-js-engine` derivation pipeline.
- Upgrades to SPLALM are inherited automatically.

Cons:
- Requires a running SPLALM backend reachable from the MCP host.
- Requires a SPLALM JWT, which today is minted by an OAuth flow.

**Auth workaround.** SPLALM expects a user with a stored
`gitlabRefreshToken`. For an MCP-style headless deployment we will:

1. Perform the OAuth flow once for a dedicated service-account GitLab user.
2. Persist its `gitlabRefreshToken` (the userId is enough — SPLALM refreshes
   automatically inside `loginUserFromId`).
3. Configure the MCP with `SPLALM_USER_ID` (the Mongo user id) plus a
   long-lived `JWT_SIGN_KEY`-signed token so it can call
   `POST /api/users/loginFromServiceToken` and obtain fresh JWTs on demand.

Alternative: add a new `POST /api/users/loginFromGitLabToken` endpoint to
SPLALM that accepts a bare GitLab PAT — cleaner long-term, but it is an
SPLALM change, not an MCP one.

### Option B — Direct integration MCP

The MCP talks directly to GitLab and re-uses `@lbdudc/gitlab-commando`,
`spl-js-engine`, and `@lbdudc/flamapy.js` to replicate SPLALM's logic without
the Express layer. No MongoDB; product spec is read/written as a file in the
product's GitLab project (e.g. `.splalm/spec.json`).

Pros:
- No SPLALM backend to deploy.
- Authenticates with a plain GitLab PAT — no JWT plumbing.
- Easier to package as a single binary / container.

Cons:
- Reimplements ~500 lines of `ProductService.generateProduct`, including the
  diff → commit-actions pipeline.
- Loses the `logs` collection (would need to be synthesized from GitLab MR
  comments or stored in a GitLab repo).
- Permission checks must be reproduced manually.

**Decision.** Start with Option A. It mirrors SPLALM exactly, and the only
serious friction (headless auth) is a small SPLALM-side addition. Option B is
a worthwhile second iteration if we ever want the MCP to ship standalone.

## Configuration

The MCP reads its configuration from environment variables (and an optional
`.env`). The complete set:

| Variable                  | Required | Notes                                                                 |
| ------------------------- | -------- | --------------------------------------------------------------------- |
| `SPLALM_BASE_URL`         | A only   | e.g. `http://localhost:3000`. Base URL for the SPLALM REST API.       |
| `SPLALM_USER_ID`          | A only   | Mongo `_id` of the SPLALM service-account user.                       |
| `SPLALM_JWT`              | A only   | Pre-issued long-lived JWT, or auto-refreshed via `/loginFromServiceToken`. |
| `GITLAB_URL`              | A + B    | e.g. `https://gitlab.example.com`.                                     |
| `GITLAB_TOKEN`            | B only   | Personal access token used for direct GitLab calls.                   |
| `SPL_LINE_ID`             | A + B    | Mongo `_id` of the Line this MCP manages.                             |
| `SPL_PROJECT_ID`          | B only   | GitLab project id of the line repo (avoids a lookup).                 |
| `MCP_LOG_LEVEL`           | optional | `info` (default) / `debug`.                                           |
| `MCP_READ_ONLY`           | optional | If `true`, mutating tools (`update_*`, `create_*`, `delete_*`, `synchronize_*`) are not registered. Useful for "let an assistant look around safely". |

## Transport

Default to **stdio** transport (standard for MCP clients like Claude
Desktop / Claude Code). Optionally expose `--http <port>` for hosted
deployments.

## Process lifecycle

1. On startup, the MCP performs a single sanity call:
   - `GET /api/lines/:SPL_LINE_ID` (Option A), or
   - `gitlabSession.getProject(SPL_PROJECT_ID)` (Option B).
2. If the call fails, the MCP exits with a clear error so the client doesn't
   register half a tool surface.
3. The line metadata (name, GitLab project id, GitLab web URL, declared
   metamodels) is cached for the session and refreshed on demand.

## Concurrency

`synchronize_product` is the only long-running tool (downloads two zips,
runs the derivation engine, runs Prettier, opens MRs). The MCP should:

- Accept the call as **synchronous** for the assistant (no streaming).
- Forward to SPLALM with a generous client timeout (e.g. 10 minutes).
- Return the final `{ conflicts, stage, mergeRequestUrl, version }` object.
- Make `get_product_logs(product_id, version)` available so the caller can
  retrieve the step-by-step log written by SPLALM during the run.

## Error mapping

SPLALM errors (`PermissionError`, `LineNotFoundError`,
`AlreadyExistentProductError`, `LinePlatformNotFoundError`,
`FeatureSelectionError`, `GitLabError`, ...) are surfaced to the MCP client
as MCP tool errors with:

- a stable `code` (e.g. `PERMISSION_DENIED`, `PRODUCT_EXISTS`,
  `FEATURE_SELECTION_INVALID`, `MERGE_CONFLICT`, `GITLAB_ERROR`),
- a human-readable `message`,
- a `details` object with whatever context SPLALM returned (MR URL, branch,
  etc.).

Critically: `synchronize_product` returning a conflict is **not** an MCP
error — it is a successful tool call whose return payload says
`conflicts: true`. Errors are reserved for "the operation could not be
attempted".
