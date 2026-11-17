# 05 — Final draft: operations of the SPL MCP

This is the condensed view. For the full schemas see
[`04-mcp-tools.md`](./04-mcp-tools.md); for the rationale see
[`02-splalm-functionalities.md`](./02-splalm-functionalities.md) and
[`03-mcp-architecture.md`](./03-mcp-architecture.md).

## Premise

- One MCP server == one SPL.
- Configured at startup with a GitLab endpoint and identity, plus the SPL's
  identifier; the SPL is never an input to a tool.
- Default implementation is a thin proxy over SPLALM's existing REST API
  (Option A in the architecture doc).
- Read-only mode is supported via `MCP_READ_ONLY=true`.

## Operations, grouped

### A. SPL inspection

1. **`get_spl_info`** — name, version, description, metamodels, GitLab URLs,
   members, product count.
2. **`list_metamodels`** — just the array of associated metamodel slugs.
3. **`list_spl_members`** — GitLab members of the SPL project.

### B. Feature model

4. **`get_feature_model`** — fetch the UVL file backing the SPL.
5. **`update_feature_model`** — overwrite the UVL file (auto-bumps SPL major
   version when content changes).
6. **`analyze_feature_model`** — run Flamapy (BDD or SAT) for satisfiability,
   core/dead/false-optional features, configuration counts, branching,
   variability metrics, etc. Defaults to the SPL's current model.

### C. Products — read

7. **`list_products`** — products of this SPL, with pagination / name search.
8. **`get_product_info`** — full product object: spec, GitLab URLs, members,
   serialized feature model.
9. **`get_product_spec`** — just the spec (handy projection).
10. **`list_product_members`** — GitLab members of the product project.
11. **`list_product_versions`** — versions for which a product has
    synchronization logs.
12. **`get_product_logs`** — log entries (info / warning / success / error)
    for a `(product_id, version)` pair.

### D. Products — write

13. **`create_product`** — create a product (and its nested GitLab project)
    under this SPL.
14. **`update_product_spec`** — replace a product's spec; SPLALM bumps the
    patch version automatically.
15. **`rename_product`** — rename product + GitLab group/project.
16. **`delete_product`** — destructive; requires `confirm: true`.
17. **`synchronize_product`** — the headline operation: regenerate code from
    the SPL + current spec, commit to `generation/<v>`, open MR into
    `bigbang`, then `bigbang → main`. Returns:
    - `{ conflicts: false, version }` on full success, or
    - `{ conflicts: true, stage: "generating"|"update", mergeRequestUrl, version }`
      when a MR could not auto-merge. The caller is expected to resolve
      the conflict in GitLab and (optionally) call `synchronize_product`
      again later.
18. **`generate_product_zip`** _(optional)_ — preview-only derivation: returns
    a base64 zip without touching GitLab.

## Open design questions

- **Headless auth.** Option A needs either (a) a small SPLALM endpoint that
  exchanges a GitLab PAT for a SPLALM JWT, or (b) a one-time bootstrap where
  a human runs the existing OAuth flow for a service account and the MCP
  stores the resulting refresh token. Recommendation: ship (b) first, add
  (a) once the MCP proves useful.
- **Metamodel mutation.** `line.models` is read-only today. If the MCP wants
  to add `add_metamodel` / `remove_metamodel`, that needs a new SPLALM route.
  Not in scope for v1.
- **Conflict resolution helpers.** Today `synchronize_product` surfaces an
  MR URL when there are conflicts. A v2 could add `list_open_merge_requests`
  and `get_merge_request_diff` tools so an assistant can reason about the
  conflict without leaving the MCP. Direct GitLab calls; not in scope for v1.
- **Streaming logs.** SPLALM emits Socket.IO events during synchronization.
  MCP tools are request/response, so v1 returns the terminal state and the
  caller polls `get_product_logs`. If a future MCP transport supports
  streaming responses, `synchronize_product` could stream the same events.

## Minimal v1 tool surface (recommendation)

If we want to ship the smallest meaningful version, register only these 12
tools and add the rest later:

```
get_spl_info
list_metamodels
get_feature_model
analyze_feature_model
list_products
get_product_info
get_product_spec
list_product_versions
get_product_logs
update_feature_model        (mutating)
update_product_spec         (mutating)
synchronize_product         (mutating, the headline tool)
```

Everything else (members, create/rename/delete product, zip preview) is a
nice-to-have layered on top.
