# 01 — SPLALM overview

This document is a quick recap of how SPLALM models things, so the MCP design
decisions in the rest of the documents are easier to follow.

## Vocabulary

- **SPL (Software Product Line) / Line**: a family of related software products
  generated from a common platform and a **feature model**. Persisted in
  MongoDB (`lines` collection) and backed by a GitLab project that holds the
  platform code and the feature model file.
- **Feature model**: a UVL file (`src/platform/model.uvl`) stored on the line's
  GitLab project, on the `main` branch. Older lines may have an XML
  equivalent (`src/platform/model.xml`).
- **Metamodels (`line.models`)**: a free-form array of strings declared on the
  Line entity. These describe additional metamodels associated with the SPL
  (e.g. data model, static-content model, etc.). They are referenced by the
  product spec when the user configures a product.
- **Product**: a concrete configuration derived from an SPL. Persisted in
  MongoDB (`products` collection) and backed by its own GitLab project,
  nested under the line's GitLab group. A product has:
  - `lineId` — reference to its SPL.
  - `spec` — the product specification (see below).
  - `gitlab` — `{ projectId, namespaceId, webUrl, webIdeUrl }`.
- **Product spec**: the JSON document that drives generation. Shape:
  ```jsonc
  {
    "basicData": {
      "name":      "string",
      "version":   "x.y.z",
      "createdAt": "Date",
      "database":  { /* free-form */ },
      "extra":     { /* free-form */ },
      "languages": ["en","es","gl"],
      "SRID":      "4326"
    },
    "dataModel": { "cells": [ /* free-form rows */ ] },
    "features":  ["FeatureA", "FeatureB", ...],
    "statics":   [ /* free-form */ ]
  }
  ```
- **Log**: synchronization/generation events for a product, scoped by
  `productId` and `version`.
- **User**: a GitLab user known to SPLALM. Authentication is OAuth against
  GitLab; SPLALM stores `gitlabAccessToken` and `gitlabRefreshToken`.

## GitLab branch convention (from `properties.yml`)

- `defaultBranch: main` — the product's default branch.
- `baseBranch: bigbang` — an integration branch that holds the latest fully
  regenerated codebase before it is merged to `main`.
- `generationBranch: generation` — a one-off branch per regenerated version,
  named `generation/<version>`. Generated code is committed here, then merged
  into `bigbang`, then `bigbang` is merged into `main`.

## End-to-end synchronization flow

When a product is "regenerated" against its SPL (`POST /api/products/:id/generate`):

1. Download the line's repository as a zip and the product's current `bigbang`
   code as a zip.
2. Run the `spl-js-engine` derivation engine over the line's platform and the
   product `spec` to produce a fresh product codebase.
3. Run Prettier over the generated code.
4. Diff against the previous `bigbang` snapshot to compute a set of
   create/update/delete actions.
5. Create a `generation/<newVersion>` branch off `bigbang` and commit the
   actions there.
6. Open a Merge Request `generation/<newVersion> → bigbang`. If it merges
   cleanly, continue; otherwise return `{ conflicts: true, stage: 'generating' }`
   with the MR URL.
7. Tag `bigbang-<newVersion>`.
8. Open (or rename) a Merge Request `bigbang → main`. If it merges cleanly,
   return success; otherwise return `{ conflicts: true, stage: 'update' }`
   with the MR URL.
9. Throughout, emit log events to the user's Socket.IO room and persist them
   as `Log` entries keyed by `(productId, version)`.

## Permission model

SPLALM checks GitLab access levels against the **line's** or **product's**
GitLab project on every operation:

| Access level | Meaning      | Used for                                                 |
| ------------:| ------------ | -------------------------------------------------------- |
| 5            | Minimal      | Reading the line zip for generation                      |
| 20           | Reporter     | Reading line/product info, members, feature model        |
| 30           | Developer    | Reading line feature model (for analysis-only flows)     |
| 40           | Maintainer   | Saving feature model, updating/renaming products, generation |
| 50           | Owner        | Deleting line or product                                 |

The MCP must preserve these checks one way or another (see
[`03-mcp-architecture.md`](./03-mcp-architecture.md)).
