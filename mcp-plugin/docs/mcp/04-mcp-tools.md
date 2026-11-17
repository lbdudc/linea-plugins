# 04 — MCP tool catalog

This is the full list of MCP tools the server registers, with input/output
schemas (informal — JSON-Schema-ish), the SPLALM operation each one wraps,
and the required GitLab access level.

Throughout: the SPL is **implicit** (bound at startup via `SPL_LINE_ID`); no
tool takes a `line_id` argument. `product_id` is the Mongo `_id` returned by
`list_products` / `create_product`.

---

## SPL metadata & feature model

### `get_spl_info`

Return the SPL's basic metadata, declared metamodels, GitLab links, and a
summary of its members and products.

- Input: `{}`
- Output:
  ```jsonc
  {
    "id":          "string",
    "name":        "string",
    "version":     "x.y.z",
    "description": "string",
    "metamodels":  ["dataModel", "..."],
    "gitlab":      { "projectId": 123, "webUrl": "...", "webIdeUrl": "..." },
    "members":     [{ "username": "...", "role": 40 }],
    "productCount": 7
  }
  ```
- Wraps: `GET /api/lines/:SPL_LINE_ID`.
- Requires access level 20.

### `list_metamodels`

Return just the metamodel slugs declared on the SPL (the `line.models`
array).

- Input: `{}`
- Output: `{ "metamodels": ["dataModel", "staticContent", ...] }`
- Wraps: `GET /api/lines/:SPL_LINE_ID` (projects `models`).
- Requires access level 20.

### `get_feature_model`

Return the SPL's UVL feature model.

- Input: `{ "format": "uvl" | "raw" }` (default `"uvl"`; `"raw"` returns the
  base64 content as GitLab serves it).
- Output: `{ "format": "uvl", "content": "features\n\t..." }`
- Wraps: `GET /api/lines/:SPL_LINE_ID/model`.
- Requires access level 30.

### `update_feature_model`

Replace the SPL's UVL feature model. If the new content differs from the
current one, SPLALM bumps the line's major version.

- Input: `{ "content": "features\n\tFoo\n\t\tmandatory\n\t\t\tBar" }`
- Output: `{ "ok": true, "newVersion": "1.0.0" }`
- Wraps: `PUT /api/lines/:SPL_LINE_ID/model`.
- Requires access level 40.
- Mutating; suppressed when `MCP_READ_ONLY=true`.

### `analyze_feature_model`

Run Flamapy analyses over a UVL string (defaults to the current SPL model).

- Input:
  ```jsonc
  {
    "uvl":  "string (optional — defaults to current SPL model)",
    "mode": "SAT" | "BDD"          // default "BDD"
  }
  ```
- Output: a subset of
  ```jsonc
  {
    "satisfiable":              true,
    "coreFeatures":             ["Foo", "Bar"],
    "deadFeatures":             [],
    "falseOptionalFeatures":    [],
    "leafFeatures":             ["A", "B"],
    "leafNumber":               12,
    "atomicSets":               [["A","B"]],
    "configurations":           [/* if mode allows */],
    "configsNumber":            42,
    "estimatedConfigurations":  42,
    "averageBranchingFactor":   2.3,
    "maxDepth":                 5,
    "uniqueFeatures":           [...],
    "configDistribution":       [...],
    "featureInclusionProb":     {...},
    "homogeneity":              0.71,
    "variability":              0.42,
    "variantFeatures":          [...]
  }
  ```
- Wraps: `POST /api/lines/analyze`.
- No GitLab access check (stateless analysis).

---

## SPL members

### `list_spl_members`

Return the GitLab project members of the SPL repo.

- Input: `{}`
- Output: `{ "members": [{ "username": "...", "role": 40 }] }`
- Wraps: nested inside `GET /api/lines/:SPL_LINE_ID`.
- Requires access level 20.

---

## Products — read

### `list_products`

Return all products belonging to this SPL.

- Input:
  ```jsonc
  {
    "search": "string (optional, name substring)",
    "limit":  20,
    "offset": 0
  }
  ```
- Output:
  ```jsonc
  {
    "products": [
      {
        "id":        "string",
        "name":      "string",
        "version":   "x.y.z",
        "createdAt": "ISO date",
        "gitlab":    { "projectId": 123, "webUrl": "..." }
      }
    ],
    "total": 7
  }
  ```
- Wraps: `GET /api/products/enrolled`, then filtered by `lineId === SPL_LINE_ID`.
- Requires access level 20 on each product.

### `get_product_info`

Full product info, including spec and resolved feature model.

- Input: `{ "product_id": "string" }`
- Output:
  ```jsonc
  {
    "id":      "string",
    "name":    "string",
    "version": "x.y.z",
    "lineId":  "string",
    "spec":    { /* full spec */ },
    "gitlab":  { "projectId": 1, "namespaceId": 2, "webUrl": "...", "webIdeUrl": "..." },
    "members": [{ "username": "...", "role": 40 }],
    "featureModel": "<serialized FeatureModel>"
  }
  ```
- Wraps: `GET /api/products/:id`.
- Requires access level 20.

### `get_product_spec`

Return just the product spec.

- Input: `{ "product_id": "string" }`
- Output: `{ "spec": { /* full spec */ } }`
- Wraps: projection of `GET /api/products/:id`.
- Requires access level 20.

### `list_product_members`

Members of the product's GitLab project.

- Input: `{ "product_id": "string" }`
- Output: `{ "members": [{ "username": "...", "role": 40 }] }`
- Wraps: nested inside `GET /api/products/:id`.
- Requires access level 20.

### `list_product_versions`

Versions for which a product has generation logs.

- Input: `{ "product_id": "string" }`
- Output: `{ "versions": ["1.2.0", "1.1.0", "1.0.0"] }`
- Wraps: `GET /api/logs/:id/versions`.
- Requires access level 20.

### `get_product_logs`

Get the log entries SPLALM wrote during a specific generation run.

- Input: `{ "product_id": "string", "version": "x.y.z" }`
- Output:
  ```jsonc
  {
    "logs": [
      {
        "version":   "1.2.0",
        "type":      "info|warning|success|error",
        "message":   "log.created_branch",
        "params":    ["generation/1.2.0", "bigbang"],
        "link":      "https://gitlab.../merge_requests/5",
        "createdAt": "ISO date"
      }
    ]
  }
  ```
- Wraps: `GET /api/logs/:id/:version`.
- Requires access level 20.

---

## Products — write

All tools in this section are suppressed when `MCP_READ_ONLY=true`.

### `create_product`

Create a new product under this SPL.

- Input:
  ```jsonc
  {
    "spec": {
      "basicData": { "name": "MyProduct", "version": "0.0.0", "languages": ["en"], "SRID": "4326" },
      "dataModel": { "cells": [] },
      "features":  ["Foo", "Bar"],
      "statics":   []
    }
  }
  ```
  (`lineId` is injected from `SPL_LINE_ID`.)
- Output: `{ "product": { /* same shape as get_product_info */ } }`
- Wraps: `POST /api/products`.
- Requires access level 20 on the SPL.
- Errors: `PRODUCT_EXISTS`, `FEATURE_SELECTION_INVALID`.

### `update_product_spec`

Replace a product's spec. Bumps the patch version automatically.

- Input: `{ "product_id": "string", "spec": { /* full spec */ } }`
- Output: `{ "product": { /* updated */ } }`
- Wraps: `PATCH /api/products/:id`.
- Requires access level 40.

### `rename_product`

Rename the product and its GitLab group/project.

- Input: `{ "product_id": "string", "name": "string" }`
- Output: `{ "product": { /* updated */ } }`
- Wraps: `POST /api/products/:id/rename`.
- Requires access level 40.

### `delete_product`

Delete the product and its GitLab group.

- Input: `{ "product_id": "string", "confirm": true }`
- Output: `{ "ok": true }`
- Wraps: `DELETE /api/products/:id`.
- Requires access level 50.
- The `confirm: true` guard is enforced by the MCP layer to make the
  destructiveness explicit to assistants.

### `synchronize_product`

Regenerate the product against the current SPL, commit the diff to a
`generation/<version>` branch, open a MR to `bigbang`, then a MR from
`bigbang` to `main`. Returns the terminal state.

- Input: `{ "product_id": "string" }`
- Output:
  ```jsonc
  {
    "version":   "1.2.0",
    "conflicts": false,
    "stage":     null,                       // "generating" | "update" when conflicts=true
    "mergeRequestUrl": "https://gitlab.../merge_requests/5",  // only when conflicts
    "product": { /* updated product, same shape as get_product_info */ }
  }
  ```
- Wraps: `POST /api/products/:id/generate`.
- Requires access level 40 on the product and access level 5 on the SPL.
- Long-running; use a generous timeout.
- Errors: `FEATURE_SELECTION_INVALID`, `LINE_PLATFORM_NOT_FOUND`,
  `GITLAB_ERROR`, `PERMISSION_DENIED`.

### `generate_product_zip` (optional)

Run the derivation engine for a product with a given spec and return the
generated codebase as a base64 zip — **without** touching GitLab. Useful for
previewing a change before calling `synchronize_product`.

- Input: `{ "product_id": "string", "spec": { /* full spec */ } }`
- Output: `{ "zipBase64": "..." }`
- Wraps: `POST /api/products/:id/zip`.
- Requires access level 20 on product, 5 on SPL.
- Likely returns large payloads; could be guarded by a config flag.

---

## Summary table

| Tool                       | Mutating | Wraps SPLALM call                                  | Min access |
| -------------------------- | -------- | --------------------------------------------------- | ---------- |
| `get_spl_info`             | no       | `GET /api/lines/:id`                                | 20         |
| `list_metamodels`          | no       | `GET /api/lines/:id`                                | 20         |
| `list_spl_members`         | no       | `GET /api/lines/:id`                                | 20         |
| `get_feature_model`        | no       | `GET /api/lines/:id/model`                          | 30         |
| `update_feature_model`     | yes      | `PUT /api/lines/:id/model`                          | 40         |
| `analyze_feature_model`    | no       | `POST /api/lines/analyze`                           | n/a        |
| `list_products`            | no       | `GET /api/products/enrolled`                        | 20         |
| `get_product_info`         | no       | `GET /api/products/:id`                             | 20         |
| `get_product_spec`         | no       | `GET /api/products/:id`                             | 20         |
| `list_product_members`     | no       | `GET /api/products/:id`                             | 20         |
| `list_product_versions`    | no       | `GET /api/logs/:id/versions`                        | 20         |
| `get_product_logs`         | no       | `GET /api/logs/:id/:version`                        | 20         |
| `create_product`           | yes      | `POST /api/products`                                | 20 (SPL)   |
| `update_product_spec`      | yes      | `PATCH /api/products/:id`                           | 40         |
| `rename_product`           | yes      | `POST /api/products/:id/rename`                     | 40         |
| `delete_product`           | yes      | `DELETE /api/products/:id`                          | 50         |
| `synchronize_product`      | yes      | `POST /api/products/:id/generate`                   | 40 + 5     |
| `generate_product_zip`     | no\*     | `POST /api/products/:id/zip`                        | 20 + 5     |

\* No GitLab side effects, but still excluded from read-only mode because it
runs the derivation engine and produces large payloads.
