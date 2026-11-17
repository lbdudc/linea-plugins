# 02 — SPLALM functionalities inventory

Raw catalog of everything SPLALM exposes today, derived from
`server/src/rest/routers/*` and the matching services. The MCP design picks
from this inventory; entries that don't make sense for a single-SPL,
non-interactive context are flagged **(skip)**.

## Users / config / auth

| Method | Path                                    | Service                         | Notes |
| ------ | --------------------------------------- | ------------------------------- | ----- |
| POST   | `/api/users/loginFromGitLab`            | `UserService.loginUserFromGitLab` | OAuth code → SPLALM JWT. Browser-driven. **(skip in MCP — replaced by a static GitLab token in config)** |
| POST   | `/api/users/loginFromServiceToken`      | `UserService.loginUserFromId`     | Refresh of existing SPLALM JWT. **(skip — JWT is handled internally by MCP if it proxies SPLALM)** |
| GET    | `/api/users/config`                     | `UserService.getConfig`           | Returns `{ clientId, redirectUri }`. UI-only. **(skip)** |

## Lines (SPLs)

| Method | Path                          | Service                                       | Notes |
| ------ | ----------------------------- | --------------------------------------------- | ----- |
| POST   | `/api/lines`                  | `LineService.createLine`                      | Creates Line + GitLab group + GitLab project. **(skip — the MCP manages an *existing* SPL)** |
| GET    | `/api/lines/enrolled`         | `LineService.findEnrolledLines`               | Lists every SPL the user can see. **(skip — single-SPL MCP)** |
| GET    | `/api/lines/:id`              | `LineService.findLineById` + members + products | Full line info + members + products list. **Keep** as `get_spl_info`. |
| DELETE | `/api/lines/:id`              | `LineService.deleteLine`                      | Deletes line + group. **(skip — destructive, out of scope for managing one SPL)** |
| GET    | `/api/lines/:id/model`        | `LineService.getFeatureModel`                 | Reads `src/platform/model.uvl` from GitLab. **Keep** as `get_feature_model`. |
| PUT    | `/api/lines/:id/model`        | `LineService.saveFeatureModel`                | Writes `src/platform/model.uvl`, bumps line major version. **Keep** as `update_feature_model`. |
| POST   | `/api/lines/analyze`          | `LineController.analyzeFeatureModel`          | Runs Flamapy over an in-memory UVL string. **Keep** as `analyze_feature_model`. |

Implicit operations exposed via the line entity:

- `line.models` — array of strings declaring associated **metamodels** for the
  SPL. Not currently mutable through a dedicated route, but readable via the
  line DTO. **Keep** as `list_metamodels`.
- `line.name`, `line.version`, `line.description`, `line.gitlabWebUrl`,
  `line.gitlabWebIdeUrl` — readable via the line DTO. Surfaced inside
  `get_spl_info`.
- `gitlabSession.getProjectMembers(...)` (line project) — **Keep** as
  `list_spl_members`.

## Products

| Method | Path                                  | Service                                | Notes |
| ------ | ------------------------------------- | -------------------------------------- | ----- |
| POST   | `/api/products`                       | `ProductService.createProduct`         | Creates product + nested GitLab group/project + `bigbang` branch. **Keep** as `create_product`. |
| GET    | `/api/products/enrolled`              | `ProductService.findEnrolledProducts`  | All products the user can see. The MCP scopes this to the bound SPL. **Keep** as `list_products`. |
| GET    | `/api/products/:id`                   | `ProductService.findProductById` + members + feature model | Full product info. **Keep** as `get_product_info`. |
| DELETE | `/api/products/:id`                   | `ProductService.deleteProduct`         | Deletes product + GitLab group. **Keep** as `delete_product` (gated). |
| PATCH  | `/api/products/:id`                   | `ProductService.updateProduct`         | Replaces `spec`, bumps patch version. **Keep** as `update_product_spec`. |
| POST   | `/api/products/:id/rename`            | `ProductService.renameProduct`         | Renames product + renames GitLab group/project. **Keep** as `rename_product`. |
| POST   | `/api/products/:id/generate`          | `ProductService.generateProduct`       | The big one: regenerate, diff, branch, MR, merge. **Keep** as `synchronize_product`. |
| POST   | `/api/products/:id/zip`               | `ProductService.generateZip`           | Runs the derivation engine and returns a base64 zip without touching GitLab. **Keep** as `generate_product_zip` (optional). |

Implicit operations exposed via the product entity:

- `product.spec` — readable; the spec the product was configured with.
  Surfaced as `get_product_spec`.
- `product.gitlab.webUrl`, `webIdeUrl`, `projectId` — surfaced inside
  `get_product_info`.
- `gitlabSession.getProjectMembers(...)` (product project) — **Keep** as
  `list_product_members`.

## Logs

| Method | Path                                | Service                          | Notes |
| ------ | ----------------------------------- | -------------------------------- | ----- |
| GET    | `/api/logs/:id/versions`            | `LogService.findVersions`        | Versions for which a product has generation logs. **Keep** as `list_product_versions`. |
| GET    | `/api/logs/:id/:version`            | `LogService.find`                | Log entries for `(productId, version)`. **Keep** as `get_product_logs`. |

## WebSocket events (informational)

During `synchronize_product` the server emits `generation` events over
Socket.IO to the user's room. Event shape:

```jsonc
{
  "version": "1.2.0",
  "type": "info|warning|success|error",
  "message": "log.created_branch",      // i18n key
  "params":  ["generation/1.2.0", "bigbang"],
  "link":    "https://gitlab.../merge_requests/5",   // optional
  "createdAt": "2026-06-01T12:34:56Z"
}
```

The MCP cannot stream Socket.IO events to a stateless tool caller, but it can
expose the corresponding log entries via `get_product_logs`. The synchronous
return value of `synchronize_product` already reports the terminal state
(`{ conflicts: bool, stage?: 'generating'|'update' }`).

## What this gives us

Combining the kept entries from the inventory:

- 1 metadata operation (`get_spl_info`)
- 4 feature-model / metamodel operations (`get_feature_model`,
  `update_feature_model`, `analyze_feature_model`, `list_metamodels`)
- 9 product operations (`list_products`, `create_product`, `get_product_info`,
  `get_product_spec`, `update_product_spec`, `rename_product`,
  `delete_product`, `synchronize_product`, `generate_product_zip`)
- 2 log operations (`list_product_versions`, `get_product_logs`)
- 2 membership operations (`list_spl_members`, `list_product_members`)

Detailed schemas for each one live in [`04-mcp-tools.md`](./04-mcp-tools.md).
