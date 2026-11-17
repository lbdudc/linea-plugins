# Agents Reference

All agents live in `server/src/agents/definitions/`. They are registered on server startup via side-effect imports in `definitions/index.js`. Each agent is a plain object with `{ type, title, description, scope, steps[] }`.

---

## Agent Overview

| Agent | Type | Scope | Trigger | LLM? |
|-------|------|-------|---------|------|
| [Line Health](#line-health-agent) | `line-health` | line | Scheduled, manual | Yes |
| [Sync](#sync-agent) | `sync` | product | Auto on conflict, manual | Yes |
| [Regen](#regen-agent) | `regen` | product | Change Set cascade, Line Sync fan-out, manual | No |
| [Line Sync](#line-sync-agent) | `line-sync` | line | Manual ("regenerate all") | No |
| [Harvest](#harvest-agent) | `harvest` | product | git host webhook on push to main, manual | Yes |
| [Evolution](#evolution-agent) | `evolution` | line | Manual, FM editor, Change Set cascade | Yes |
| [FM Constraint Advisor](#fm-constraint-advisor) | `fm-constraint-advisor` | line | Manual | Yes |
| [Feature Location](#feature-location-agent) | `feature-location` | line | Manual | Yes |
| [Variant Miner](#variant-miner) | `variant-miner` | line | Scheduled, manual | Yes |
| [Change Set](#change-set-agent-co-evolution) | `changeset` | line | FM editor Save, git host branch, chat, accepted Harvest, manual | No¹ |

**Scope** determines where a run is launched from:
- `product` — launched from ProductDetail page (or auto-triggered), scope includes `productId` + `lineId`
- `line` — launched from the Agents page (line scope), scope includes `lineId` only

> `line-health` consolidates the former `spl-health-snapshot`, `steward`, `fm-health`, and `coverage-analysis` agents. All four concerns (product validity, FM structure, portfolio coverage, git host anti-patterns) are now sections of one report.

> ¹ None of `changeset`'s 11 run steps are `llm` kind — the LLM involvement (drafting a proposal from a natural-language intent) happens in a separate chat session *before* a run exists (`ChangeSetProposalSession` / "Propose with AI"), not inside the run itself. See [Change Set Agent](#change-set-agent-co-evolution).

> **Naming trap:** `sync` (product scope, title "Sync Agent") diagnoses one product's merge conflict. `line-sync` (line scope, title "Sync") fans out a `regen` per product across an entire line. Same word, different agents — see [Line Sync Agent](#line-sync-agent).

---

## Line Health Agent

**Purpose:** Unified, read-only health report for an SPL. Combines product validity, FM structural analysis, 1-wise/2-wise coverage, portfolio anomalies, and git host anti-patterns into a single Red/Amber/Green report.

**Auto-trigger:** If `HEALTH_INTERVAL_MS` is set in env, `scheduler.js` runs Line Health for each line on that interval, attributed to `BOT_USER` or `line.ownerId`.

**Manual trigger:** Agents page (line scope).

**Output (result scalars):** `lineName`, `summary` (valid/invalid/total), `criticalIssues`, `amberIssues`, `coverage1Wise`, `coverage2Wise`, `antiPatternsFlagged`, `markdown`.

### Steps

| Step | Kind | What it does |
|------|------|-------------|
| `load-context` | deterministic | `loadFeatureModel` + `scanProducts`; extracts FM feature names via `fmAnalysis.extractFeaturesFromModel` |
| `analyse` | deterministic | Re-loads model; probes void + mandatory; probes each non-mandatory feature (`completeFeatureSelection([F])`); calls `computePortfolioAnomalies` for stranded/zombie/coupling; computes 1-wise/2-wise coverage + risky uncovered pairs |
| `scan-anti-patterns` | git | Per product: fetches open MRs; flags conflicting MRs and stale `generation/*` branches |
| `narrate` | llm | Claude synthesises all findings into a structured Health Summary / Product Validity / FM Structure / Portfolio Anomalies / Coverage / git host Anti-patterns report |

### Anomaly taxonomy

| Anomaly | Severity | Detection method |
|---------|----------|-----------------|
| **Void model** | CRITICAL | `completeFeatureSelection([])` throws |
| **Non-selectable feature** | CRITICAL | `completeFeatureSelection([F])` throws |
| **Invalid product** | CRITICAL | `completeFeatureSelection(product.features)` fails |
| **Stranded feature** | AMBER | In FM but no valid product selects it (not mandatory) |
| **Zombie optional** | AMBER | Declared Optional in FM but every valid product selects it |
| **Coupling smell** | AMBER | Two features always co-selected whenever either is chosen |
| **Anti-pattern** | AMBER | Conflicting open MR or stale generation branch on a product |

### Coverage metrics

| Metric | Definition |
|--------|-----------|
| **1-wise coverage** | % of FM features selected by at least one valid product |
| **2-wise coverage** | % of FM feature *pairs* that co-appear in at least one valid product |
| **Stranded** | Features in FM that no product ever selects (not mandatory) |
| **Zombie optionals** | Features declared Optional in FM but selected by every valid product |
| **Coupling smells** | Feature pairs that are *always* co-selected whenever either is chosen |
| **Risky pairs** | Used features never tested together, ranked by combined selection frequency |

---

## Sync Agent

**Purpose:** Diagnoses a failed `bigbang → main` merge and proposes a resolution.

**Auto-trigger:** `domainSubscriber.js` enqueues a Sync run whenever `ProductService.generateProduct` emits `PRODUCT_GENERATED` with `conflicts: true`.

**Manual trigger:** "Diagnose sync" button on ProductDetail.

### Steps

#### 1. `load-context` — deterministic
- Checks `ctx.productId`
- Loads product, verifies user access (level 20+)
- Reads generation logs for the version

#### 2. `diagnose` — deterministic
- Calls `classifyLogs(logs)` — a table-driven classifier keyed on the last error/warning log's i18n key suffix:

  | i18n key suffix | verdict |
  |----------------|---------|
  | `gen_error` | generating conflict |
  | `update_error` | update conflict |
  | `missing_func` | platform function missing |
  | `empty_output` | empty generation |
  | `success` | no conflict |
  | _(none)_ | no log data |

- Output: `{ status, stage: 'generating'|'update', diagnosis: { title, action } }`

#### 3. `fetch-conflict-details` — git
- Reads the open MR and its conflicting files via `getMergeRequests` + `getMergeRequestChanges`
- Classifies each file:
  - `'ours'` — known customization files (`README.md`, `.env`, `.gitignore`, `docker-compose.*`, `.gitlab-ci.* / .github/`)
  - `'theirs'` — everything else (generator-owned)
- `unambiguous = true` when ALL conflicting files are `'theirs'`

#### 4. `explain` — llm
- Claude writes a per-file resolution plan in markdown (no tool use, single completion)
- Skips if no conflict detected

#### 5. `resolve-edits` — llm (update stage only)
- `runSyncResolution` → tool loop with `read_file(branch)` + `propose_resolution` tools
- Produces full reconciled file content for each conflicting file
- `prior` re-seeding lets `/refine` revise the plan

#### 6. `test-resolution` — llm
- Runs proposed resolution through PlaygroundService (isolated sandbox)
- Up to 5 automated refinement attempts on test failure

#### 7. `propose-resolution` — approval
Two proposal paths:

| Condition | Proposal kind | blastRadius | Unambiguous? |
|-----------|--------------|-------------|--------------|
| update stage + reconciled files | `merge_resolution` | `product` | always `false` (rich review required) |
| generating stage / no resolution | `git_comment` | `product` | mirrors `unambiguous` from step 3 |

`merge_resolution` proposal body includes:
- `fileEdits[{path, newContent, oldContent, rationale}]` — full old vs. new for diff viewer
- `plan` — raw tool input for `/refine`

#### 8. `apply-resolution` — git
- `merge_resolution` approved → `commitResolution` to MR source branch → `recheckMergeability`
- `git_comment` approved → `postMergeRequestComment`

---

## Regen Agent

**Purpose:** Regenerate one product against the current platform. The primitive
underneath both Line Sync's fan-out and a Change Set's `cascade` step — the same
regeneration a "Generate" click on ProductDetail triggers, wrapped as an agent run so
it can be a cascade child with its own status and, on conflict, auto-spawn a `sync`
child of its own.

**Trigger:** Spawned as a child by Line Sync or a Change Set's `cascade` step; not
normally launched directly.

### Steps

| Step | Kind | What it does |
|------|------|-------------|
| `regenerate` | `regen` (custom kind, its own timeout) | Runs the same generation pipeline as `ProductService.generateProduct` — see [flows.md §2](flows.md#2-generate-a-product). On merge conflict, the run emits `PRODUCT_GENERATED { conflicts: true }`, and `domainSubscriber.js` enqueues a `sync` run as its child, same as a manual generate. |

---

## Line Sync Agent

**Purpose:** Regenerate every product in a line against the current platform in one
operation — the line-wide counterpart to a single product's "Generate" button.
**Not the same agent as [Sync](#sync-agent) above** despite the near-identical name;
see the naming-trap note in the [overview table](#agent-overview).

**Manual trigger:** "Regenerate all" on the Sync Console (`SyncConsole.vue`, Agents
page → Propagation tab). `input: { productIds?, force? }` — `productIds` lets the
operator deselect products from the run; omitted means every product in the line.

### Steps

| Step | Kind | What it does |
|------|------|-------------|
| `plan` | deterministic | Resolves the target product list (all, or `input.productIds`) |
| `fan-out` | deterministic | Spawns one [Regen](#regen-agent) child run per product (`ctx.spawnChild`); the parent reaches `awaiting_child` until every child is terminal |

---

## Harvest Agent

**Purpose:** Lifts a direct product-side customization back into the SPL platform as a line-repo MR adding a new optional feature.

**Auto-trigger:** push event from LINEA (`git:pushed` → `POST /api/events`) when someone pushes directly to `main` on a product repo. See [git-events.md](git-events.md) for setup.

**Manual trigger:** "Harvest" button on ProductDetail.

**Duplicate guard:** If a harvest run is already `queued/running/awaiting_*` for the same product, the webhook skips the new trigger.

### Steps

#### 1. `detect-changes` — git
- `compareBranches(bigbang → main)` — returns files changed beyond the generated baseline
- If empty → run finishes cleanly (no-op; generation's own merge fires this same path but finds nothing)
- Also reads the line's feature model (UVL preferred, XML fallback)

#### 2. `propose-plan` — llm (tool loop, maxTurns=12, maxTokens=8192)
Available tools:

| Tool | What it does |
|------|-------------|
| `list_platform_files` | Lists blobs under `src/platform/` in the line repo |
| `read_platform_file` | Reads a specific file from the line repo at `main` |
| `propose_harvest` | Structured proposal: `featureName`, `newModelUvl`, `fileEdits[]`, `reasoning` |

The LLM reads the actual platform files before proposing changes, so edits are grounded in the real code.

Output cached in `oldContent` per file for diff view.

#### 3. `validate-fm` — deterministic
- Parses `newModelUvl` with `spl-js-engine`
- Calls `completeFeatureSelection(features)` for every product in the line
- Returns `{ valid, broken[] }` — if any product would break, the run is **blocked**

#### 4. `propose-harvest` — approval
| Condition | Outcome |
|-----------|---------|
| FM change would break a product | Blocked — no MR opened, reason shown |
| No FM patch AND no file edits | Advisory only — markdown result, no proposal |
| FM patch or file edits present | `fm_patch` proposal — always `blastRadius='line'` (see [autonomy.md](autonomy.md)) |

Proposal body:
- `fmOld` / `newModelUvl` — feature model diff
- `fileEdits[{path, action, newContent, oldContent, rationale}]`
- `plan` (raw) — for `/refine` iterations
- `versions[]` — history of prior proposals (snapshot on each `/refine`)

#### 5. `open-mr` — git
On approval:
1. Create branch `harvest/<featureName>-<timestamp>` off `main` in the line repo
2. Single commit: `model.uvl` + all `fileEdits` together
3. `createMergeRequest` → `postMergeRequestComment` with plan markdown
4. Returns `{ mrUrl, branch, filesCommitted }`

---

## Evolution Agent

**Purpose:** When the feature model changes, finds products with invalid feature selections and proposes minimal spec fixes.

**Modes:**
- `migration` (default) — finds and fixes products invalidated by the **current** model
- `impact` (read-only) — previews which products would break or be fixed by a **proposed** model (`input.proposedModelUvl`)

**Manual trigger:** Agents page (line scope) or "Preview impact" button in the FeatureModelEditor toolbar (impact mode).

### Steps

| Step | Kind | What it does |
|------|------|-------------|
| `scan` | deterministic | `completeFeatureSelection` for every product; impact mode compares current vs. proposed |
| `propose-fixes` | llm | Claude proposes minimal feature-selection changes for each broken product |
| `validate-fixes` | deterministic | Re-validates each proposed patch |
| `propose-apply` | approval | `spec_patch` proposal (`blastRadius='product'`); impact mode is advisory-only (no proposal) |
| `apply-fixes` | deterministic | `ProductService.updateProduct` per patched product on approval |

---

## FM Constraint Advisor

**Purpose:** Closes the loop on coupling smells by proposing formal UVL constraints. Every candidate constraint is validated against all products before being included — a constraint that would break any existing product is silently dropped. If approved, opens a line-repo MR.

**Manual trigger:** Agents page (line scope). Typically run after Line Health identifies coupling smells.

**Input:** `input.dryRun` — if `true`, skips git host writes (validate + preview only).

**Output (result scalars):** `opened`, `dryRun`, `constraintsAdded`, `mrUrl`.

### Steps

| Step | Kind | What it does |
|------|------|-------------|
| `detect-smells` | deterministic | `loadFeatureModel` + `scanProducts`; calls `computePortfolioAnomalies` for coupling smells, stranded features, zombie optionals |
| `draft-constraints` | llm | Claude proposes UVL constraint expressions (`A <=> B` or `A => B`) for each coupling smell it is confident about |
| `validate-constraints` | deterministic | Each proposed constraint is tested against every product via `validateModelAgainstProducts`; breaking constraints are dropped |
| `propagation-preview` | deterministic | For each validated constraint, shows which products would be affected |
| `propose-patch` | approval | `fm_patch` proposal (`blastRadius='line'`); shows UVL diff, product impact, advisory notes |
| `open-mr` | git | Re-validates live model before writing; appends constraint lines; opens line-repo MR via `openLineHarvestMr` |

---

## Feature Location Agent

**Purpose:** Given a feature name from the feature model, finds which platform functions and code constructs implement it. Uses two complementary signals:

1. **Differential (deterministic):** `completeFeatureSelection` is run with and without the target feature. The delta — features added purely because the target was selected — reveals the feature's FM dependency footprint. The product portfolio is also mined for co-selection correlations.
2. **Semantic (LLM tool loop):** Claude reads `src/platform/extra.js`, `src/platform/transformation.js`, and other platform files, identifying functions whose names, comments, or conditional logic reference the feature.

**Input:**
- `input.featureName` *(required)* — exact feature identifier from the FM
- `input.annotate` *(optional, default false)* — if `true`, also proposes adding `/** @feature <name> */` JSDoc above each identified function as a line-repo MR

**Manual trigger:** Agents page (line scope). The "Feature name" field and "Propose @feature annotations" checkbox appear when `feature-location` is selected.

**Output (result scalars):** `featureName`, `productsWithFeature`, `matchesFound`, `deltaFeatures`, `featureSelectable`.

### Steps

| Step | Kind | What it does |
|------|------|-------------|
| `load-context` | deterministic | `loadFeatureModel` + `scanProducts`; validates `featureName` is present in the FM; splits portfolio into products that do and don't select the feature |
| `differential-derivation` | deterministic | Probes FM: `completeFeatureSelection([featureName])` vs. `completeFeatureSelection([])` → computes `deltaFeatures` and per-feature conditional co-selection rates from the portfolio |
| `locate-in-platform` | llm (tool loop, maxTurns=8) | Claude reads platform files and calls terminal tool `report_feature_location`; degrades gracefully if git host is unavailable |
| `reconcile` | llm | Merges both signals into a ranked markdown feature map (Implementation Footprint / FM Impact / Recommendation) |
| `propose-annotation` | git | Skipped unless `input.annotate=true` and HIGH/MEDIUM matches exist; reads matched files, inserts `/** @feature <name> */` via `insertFeatureAnnotation`, returns `annotation_mr` proposal |
| `apply-annotation-mr` | git | On approval: `createBranch` + commit annotated files + `createMergeRequest` on the line repo |

### Tool loop (step 3)

| Tool | Description |
|------|-------------|
| `list_platform_files` | Lists blobs under `src/platform/` in the line repo |
| `read_platform_file` | Reads a file at a given path under `src/` |
| `report_feature_location` | Terminal tool — returns `{ matches[{file, symbol, confidence, signalType, rationale}], summary }` |

---

## Variant Miner

**Purpose:** The portfolio-level aggregator above Harvest. Runs Harvest's deterministic detection + classification across *every* product in a line and clusters the divergences by the generator-owned files they touch. The same change appearing across many products is the strongest signal it belongs in the platform. Read-only: it ranks candidate harvests and recommends the highest-value one — a human then runs Harvest on the representative product.

**Manual trigger:** Agents page (line scope). **Scheduler-capable**, like Line Health.

**Output (result scalars):** `lineName`, `productsScanned`, `candidates`, `topCandidate`, `markdown`.

### Steps

| Step | Kind | What it does |
|------|------|-------------|
| `load-context` | deterministic | Scans the line and lists every product to inspect |
| `detect-per-product` | git | For each product, detects direct changes beyond the generated baseline and computes the deterministic classification signals — no LLM calls |
| `aggregate` | deterministic | Clusters product divergences by shared generator-owned files and ranks candidate harvests (corroborated, multi-product candidates first) |
| `narrate` | llm | Claude writes a ranked Candidate Harvests report and recommends the single highest-value candidate to harvest first |

---

## Change Set Agent (Co-Evolution)

**Purpose:** Governs a single FM or platform change from cause to consistency across
the whole product family — the largest agent in the system (11 steps) and the primary
vehicle for stages 2–3 of the [round trip](flows.md#round-trip-overview). Full
step-by-step walkthrough with the durable `ChangesetVersion` model: **[flows.md §6](flows.md#6-change-set-flow-co-evolution)**.

**Manual trigger:** Agents page → Co-Evolution tab ("New version" / "Fork" / "From
branch" / "Propose with AI"), the FeatureModelEditor's Save action, or promoting an
accepted Harvest proposal (`POST /runs/:id/to-changeset`). A version only becomes a
run once **promoted**.

**Output (result scalars):** `editClass`, `cascade` (per-product action list), `stats`,
`verifyMarkdown`, `sandbox`.

### Steps

| Step | Kind | What it does |
|------|------|-------------|
| `plan` | git | Loads the proposed FM from the version's `plan/` branch; classifies the edit (`refactoring` \| `generalization` \| `specialization` \| `arbitrary`) via `tools/fmEditClass.js`; partitions every product into `migrate` \| `regen` \| `skip` \| likely-conflict |
| `approve-plan` | approval | Human review gate: edit class, per-product action table, autonomy mode selection (manual / semi / automatic) |
| `sandbox` | approval | Optional pre-merge iteration on the `plan/` branch (FM + annotated platform code), previewed via the playground. Skipped in automatic mode or with no working branch |
| `merge-branch` | git | Merges `plan/` → `main` on the line repo via a git host MR; invalidates the FM cache |
| `propagate-features` | deterministic | For every product marked Include, adds each new optional feature into `spec.features` — without this the cascade would produce no functional diff, since new code is feature-gated |
| `cascade` | deterministic | Fans out one child run per product — [Evolution](#evolution-agent) for spec-invalid products, [Regen](#regen-agent) for regen-needed ones; a conflicting Regen auto-spawns [Sync](#sync-agent) |
| `verify` | deterministic | Aggregates every child outcome |
| `test` | `playground` | Runs every affected product's real test suite against post-cascade `main` in parallel batches; persists `TestResult`. Generalization edits with new features also get 1-wise interaction testing |
| `approve-tests` | approval | Human review gate on test outcomes — semi-auto approves on all-green, manual always pauses |
| `deploy` | git | Merges each selected product's `bigbang` → `main` (the "publish this regen live" step); per-product failures land in the ledger for individual retry |
| `record` | deterministic | Writes an `AgentMemory` fact (edit class, autonomy, cascade + test outcomes) for future plans to recall |

---

## Shared Infrastructure

### `llm.js`

Two exported functions:

| Function | When used |
|----------|-----------|
| `complete({ system, messages, maxTokens, memories? })` | Single-turn completion (explain, diagnose steps) |
| `runToolLoop({ system, messages, tools, maxTurns, maxTokens, memories? })` | Multi-turn tool-use loop — executes tool calls, feeds results back, repeats until `stop_reason='end_turn'` or maxTurns |

Both accept an optional `memories` string array (see [Agent Memory](#agent-memory)). When provided, `buildSystem()` appends a `## Memory from past runs` block to the system prompt before the call.

### Step Kinds

| Kind | Meaning |
|------|---------|
| `deterministic` | Pure computation — no LLM, no external calls |
| `git` | Reads or writes the repositories through LINEA's API (`/api/repos/:id/*`) |
| `llm` | Uses the Anthropic API |
| `approval` | May produce a `proposal`; runner pauses until ApprovalGate decides |
| `playground` | Runs a real test suite in a Docker sandbox via `PlaygroundService` (Change Set's `test` step) |
| `regen` (custom) | [Regen Agent](#regen-agent)'s single step — the generation pipeline, with its own timeout distinct from the other kinds |

### Shared FM Analysis Helpers (`tools/fmAnalysis.js`)

| Export | Description |
|--------|-------------|
| `extractFeaturesFromModel({ modelStr, type })` | Conservative UVL/XML parser; returns all feature identifier strings |
| `computeMandatoryFeatures({ model })` | Probes `completeFeatureSelection([])` to detect void model + mandatory features |
| `computePortfolioAnomalies({ allFmFeatures, validVerdicts, mandatory })` | Returns `{ stranded, zombieOptionals, couplingSmells, selectedFeatures }` in one pass |
| `computePairCoverage(fmFeatures, productFeatureSets)` | Returns `{ coveredPairs: Set, totalPairs }` for 2-wise coverage computation |
| `findCouplingSmells(fmFeatures, validVerdicts)` | Returns pairs always co-selected whenever either feature is chosen |

### Step Return Contract

```js
{
  output?: any,       // persisted to step.outputSummary (readable by later steps via ctx.getStepOutput)
  proposal?: {        // if present, goes through ApprovalGate
    kind: string,
    blastRadius: 'product' | 'line',
    target: object,
    body: object,
    unambiguous?: boolean,
  },
  result?: any,       // written to run.result (the final outcome shown in the UI)
  awaitChild?: true,  // orchestration primitive — pause without advancing cursor
}
```

---

## Agent Memory & RAG

Agents accumulate knowledge from past runs so their LLM steps improve over time. Memory is **retrieval-augmented**: rather than always injecting the most *recent* memories, the runner embeds a description of the current run and injects the most *relevant* ones (cosine similarity over vector embeddings), falling back to recency when no embedding provider is configured. See [agent-architecture.md](agent-architecture.md) for the full data-flow diagrams and the research grounding in [research-gaps-and-agents.md](research-gaps-and-agents.md).

### Model

`server/src/agents/models/AgentMemory.js`

| Field | Type | Description |
|-------|------|-------------|
| `scope.lineId` | ObjectId | Required — the line this memory belongs to |
| `scope.productId` | ObjectId\|null | If set, narrows the memory to one product within the line |
| `agentType` | string | `'sync'`, `'harvest'`, `'evolution'`, …, or `'manual'` for human notes |
| `kind` | enum | `decision`, `fact`, or `lesson` (see below) |
| `content` | string | Human-readable memory string injected into the LLM system prompt |
| `sourceRunId` | ObjectId\|null | The run that produced this memory (null for manual notes) |
| `embedding` | [Number] | Vector embedding of `content` (`select: false` — fetched only for ranking) |
| `embeddingModel` | string | The embedding model that produced the vector (provenance for re-embedding) |

**Memory kinds:**

| Kind | When created | Example content |
|------|-------------|----------------|
| `decision` | After every human or auto approval/rejection | `"Harvest proposal 'add-login' was rejected. Kind: fm_patch."` |
| `fact` | When a run reaches `done` | `"Harvest MR opened for feature 'dark-mode'. Files committed: 3."` |
| `lesson` | Authored by a human via the memory card | `"Never auto-resolve conflicts in the billing product."` |

### Capture

`MemoryService` writes memories fire-and-forget — a failure never blocks a run. Each write embeds `content` best-effort (see `EmbeddingService`, self-hosted HuggingFace TEI); if embedding fails the memory is still stored, just without a vector (recency-only retrieval still works).

| Event | Memory written | `agentType` |
|-------|---------------|-------------|
| Human approves/rejects a proposal (`AgentRunner.decideProposal`) | `decision` | the run's agent |
| Auto-gate approves a proposal (inside `AgentRunner.#advance`) | `decision` | the run's agent |
| A run reaches `done` for sync, harvest, or evolution | `fact` | the run's agent |
| A human adds a note in the UI | `lesson`/`decision`/`fact` | `'manual'` |

### Retrieval (RAG)

Before advancing each run, `AgentRunner.#advance` calls `MemoryService.retrieveRelevant`:

1. **Query** — `#memoryQuery(run)` builds a natural-language string from the agent's title + description + all string inputs.
2. **Embed** — the query is embedded as a `query`-type vector.
3. **Candidate pool** — `findCandidates` loads up to 300 recency-ordered memories for the scope **filtered to `{ agentType ∈ [run.agentType, 'manual'] }`** — the agent's own memories plus human-authored notes (which are meant for every agent). Both line-scoped and product-scoped rows are included.
4. **Rank** — cosine similarity between the query vector and each candidate's embedding; the top-K (8) above the `MIN_SCORE` threshold (0.5) are kept. The threshold keeps loosely related memories out of the prompt.
5. **Fallback** — if there's no embedding provider, no query, or zero ranked results, fall back to `loadForScope` (recency-only). Zero regression vs. the pre-RAG behaviour.

The retrieved strings are injected by `llm.js`'s `buildSystem()` under a `## Memory from past runs` block, after the base system prompt and any operator instructions.

LLM steps that use memories: Sync (`explain`, `resolve-edits`), Harvest (`propose-plan`), Evolution (`propose-fixes`), Line Health (`narrate`), FM Constraint Advisor (`draft-constraints`), Feature Location (`locate-in-platform`, `reconcile`), Variant Miner (`narrate`).

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/memory?lineId=&productId=&limit=` | List memories for a scope (recency) |
| `GET` | `/api/agents/memory/search?lineId=&productId=&q=&k=` | Semantic recall: top-K relevant memories **with** similarity scores (un-thresholded — diagnostic) |
| `POST` | `/api/agents/memory` | Add a manual note |
| `DELETE` | `/api/agents/memory/:id` | Delete a single memory |
| `DELETE` | `/api/agents/memory?lineId=&productId=` | Delete all memories for a scope (clear all) |

### UI

`AgentMemoryCard` (`client/src/features/agents/AgentMemoryCard.vue`) is placed in LineDetail, ProductDetail, and the Agents → Customization tab. It lists memories with a kind badge (Decision / Outcome / Lesson), agent type, date, and content. A search box runs semantic recall (`/memory/search`) and shows each match's relevance **score** as a percentage chip — the same ranking the runner uses, so it doubles as a "what would this agent recall?" preview. With no query it shows the recency list. Per-row delete and a header "Clear all" complete the controls.

> **Threshold note:** run injection is thresholded (`MIN_SCORE`) so only genuinely relevant memories reach the prompt; the UI search is *not* thresholded so operators can see weak matches and their scores.
