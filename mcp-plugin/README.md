# SPLALM MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes a **single SPLALM Software Product Line (SPL)** to AI assistants such as Claude Desktop or Claude Code.

The server acts as a thin proxy: each MCP tool maps to one or two SPLALM REST calls, so all business logic, permission checks, and GitLab orchestration stay inside SPLALM itself.

```
AI assistant ──► splalm-mcp-server ──► SPLALM REST API ──► MongoDB + GitLab
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js ≥ 18** | Required by the MCP SDK and the `fetch` built-in |
| **SPLALM server running** | The MCP is a proxy — it cannot work without it |
| **GitLab instance** | Used by SPLALM for product repos; must be reachable from the SPLALM server |
| **A SPLALM account** | You need at least Reporter access (level 20) on the target SPL |

---

## Setup

### 1 — Clone and install dependencies

```bash
git clone <this-repo>
cd splalm-mcp
npm install
```

### 2 — Build

```bash
npm run build
```

The compiled output lands in `dist/`.

### 3 — Create your `.env` file

```bash
cp .env.example .env
```

Then fill in the values (see [Environment variables](#environment-variables) below).

### 4 — Get a SPLALM JWT

The MCP authenticates to SPLALM using a JWT. To obtain one:

1. Open your SPLALM instance in a browser and log in normally.
2. Open DevTools → **Application** (Chrome) or **Storage** (Firefox) → **Local Storage**.
3. Copy the value of the `token` key (it starts with `eyJ…`).
4. Paste it into `SPLALM_JWT=` in your `.env`.

The MCP automatically refreshes the token before it expires (~115 min) using `POST /api/users/loginFromServiceToken`, so you only need to do this once per session (or after a full session expiry).

### 5 — Find your SPL Line ID

`SPL_LINE_ID` is the MongoDB `_id` of the Software Product Line you want to expose. You can find it in several ways:

- **From the SPLALM UI URL**: navigate to your SPL — the URL contains the line ID (e.g. `/lines/64a1f3b2c9e4a00012abc123`).
- **From the SPLALM API**: `GET /api/lines` returns all lines your user can see; each object has an `_id` field.
- **From MongoDB directly**: `db.lines.find({ name: "your-spl-name" }, { _id: 1 })`.

Paste the ID into `SPL_LINE_ID=` in your `.env`.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SPLALM_BASE_URL` | no | `http://localhost:3000` | Base URL of the running SPLALM backend |
| `SPLALM_JWT` | **yes**, unless `SPLALM_GIT_TOKEN` | — | JWT obtained from a SPLALM browser session |
| `SPLALM_GIT_TOKEN` | no | — | Instead of the JWT: the git token of the account (on a LINEA that keeps its repositories itself, the one shown when it is made or renewed in *Local account*). It does not expire with a session |
| `SPLALM_GIT_HOST` | no | primary host | With `SPLALM_GIT_TOKEN`: the host that vouches for the token (`local`, `gitlab`, `github`) |
| `SPL_LINE_ID` | **yes** | — | MongoDB `_id` of the SPL this server manages |
| `MCP_READ_ONLY` | no | `false` | Set to `true` to disable all mutating tools (safe for exploration) |
| `MCP_LOG_LEVEL` | no | `info` | Log verbosity: `info` or `debug` |

---

## Registering with an MCP client

### Claude Desktop

Add an entry to `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "splalm": {
      "command": "node",
      "args": ["/absolute/path/to/splalm-mcp/dist/index.js"],
      "env": {
        "SPLALM_BASE_URL": "http://localhost:3000",
        "SPLALM_JWT": "eyJhbGci...",
        "SPL_LINE_ID": "64a1f3b2c9e4a00012abc123"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Claude Code (CLI)

```bash
claude mcp add splalm -- node /path/to/splalm-mcp/dist/index.js
```

Then set the env vars in your `.env` file or export them in your shell before launching `claude`.

Alternatively, add it to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "splalm": {
      "command": "node",
      "args": ["./dist/index.js"],
      "cwd": "/path/to/splalm-mcp",
      "env": {
        "SPLALM_BASE_URL": "http://localhost:3000",
        "SPLALM_JWT": "eyJhbGci...",
        "SPL_LINE_ID": "64a1f3b2c9e4a00012abc123"
      }
    }
  }
}
```

### Dev mode (no build step)

```bash
npm run dev
```

Uses `tsx` for hot-reload. The `.env` file in the project root is loaded automatically.

---

## Startup check

On every start the server validates that SPLALM is reachable and `SPL_LINE_ID` resolves to a real SPL before registering any tools. If the check fails you will see:

```
[splalm-mcp-server] Startup check failed: Cannot reach SPLALM at http://localhost:3000
[splalm-mcp-server]   • SPLALM running at: http://localhost:3000
[splalm-mcp-server]   • SPL_LINE_ID:       64a1f3b2c9e4a00012abc123
[splalm-mcp-server]   • Make sure SPLALM is running and SPLALM_JWT is valid.
```

The process exits with code 1 so the MCP client does not register a broken tool surface.

---

## Available tools

The SPL is **implicit** — fixed at startup via `SPL_LINE_ID`. No tool takes a `line_id` argument.

### SPL info

| Tool | Description | Min GitLab access |
|---|---|---|
| `get_spl_info` | Full SPL metadata, members, product count | Reporter (20) |
| `list_metamodels` | Metamodel slugs declared on the SPL | Reporter (20) |
| `list_spl_members` | GitLab project members and their roles | Reporter (20) |

### Feature model

| Tool | Description | Min GitLab access |
|---|---|---|
| `get_feature_model` | Return the UVL feature model | Developer (30) |
| `update_feature_model` | Replace the UVL feature model (bumps major version) | Maintainer (40) |
| `analyze_feature_model` | Run Flamapy analyses (SAT/BDD) on any UVL string | none |

### Products — read

| Tool | Description | Min GitLab access |
|---|---|---|
| `list_products` | All products for this SPL (supports search/pagination) | Reporter (20) |
| `get_product_info` | Full product info including spec | Reporter (20) |
| `get_product_spec` | Just the product spec JSON | Reporter (20) |
| `list_product_members` | GitLab members of a product's repo | Reporter (20) |
| `list_product_versions` | Versions that have generation logs | Reporter (20) |
| `get_product_logs` | Step-by-step log of a specific generation run | Reporter (20) |

### Products — write

These tools are disabled when `MCP_READ_ONLY=true`.

| Tool | Description | Min GitLab access |
|---|---|---|
| `create_product` | Create a new product under this SPL | Reporter (20) on SPL |
| `update_product_spec` | Replace a product spec (auto-bumps patch version) | Maintainer (40) |
| `rename_product` | Rename a product and its GitLab group/project | Maintainer (40) |
| `delete_product` | Delete a product and its GitLab group | Owner (50) |
| `synchronize_product` | Regenerate the product from the current SPL and open GitLab MRs | Maintainer (40) + Reporter (5) on SPL |
| `generate_product_zip` | Dry-run generation; returns a base64 zip without touching GitLab | Reporter (20) |

> **Note on `synchronize_product`:** This is a long-running operation (downloads repo zips, runs the derivation engine, opens MRs — can take several minutes). If GitLab merge conflicts occur the tool returns `{ conflicts: true, stage: "...", mergeRequestUrl: "..." }` — this is a successful call, not an error. Use `get_product_logs` afterwards to inspect the step-by-step trace.

---

## Read-only mode

Set `MCP_READ_ONLY=true` to disable all state-changing operations. Mutating tools are not registered at all (they will not appear in the tool list the assistant sees). Useful for safely giving an assistant read access to browse an SPL without risk of accidental writes.

---

## JWT refresh

JWTs issued by SPLALM expire after ~115 minutes. The server proactively calls `POST /api/users/loginFromServiceToken` 10 minutes before expiry and updates its in-memory token. If a request receives a `401` despite this, the server attempts one immediate refresh before failing.

If the session is fully lost (e.g. the server was stopped for a long time), re-issue a new JWT from your browser, update `SPLALM_JWT` in `.env`, and restart the MCP server.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot reach SPLALM at http://…` | SPLALM backend not running | Start the SPLALM server |
| `Startup check failed: HTTP 401` | JWT is missing or expired | Re-obtain a JWT from the browser (step 4 above) |
| `Startup check failed: HTTP 404` | `SPL_LINE_ID` does not exist | Double-check the MongoDB `_id` |
| Tool returns `Permission denied` | GitLab access level too low | Add the SPLALM user as Maintainer/Owner on the SPL or product GitLab project |
| `synchronize_product` times out | Generation is slow for large SPLs | Increase the MCP client timeout; logs are preserved and retrievable with `get_product_logs` |
