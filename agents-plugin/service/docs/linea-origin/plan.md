> **Histórico.** Este plan es de cuando agents hablaba con GitLab (`gitlabClient`, `productGitlabAccess`). Hoy todo el git va por LINEA (`server/src/linea/repo.js`); los nombres de abajo son los de entonces.

# Plan — Execution-Verified Variability Documentation (Agents C + D)

## Context

LINEA already has a complete *in-server* agent ecosystem (sync, harvest, evolution,
line-health, feature-location, …) and an MCP that exposes the whole SPL — including a
full agent control surface (`launch_agent`, `decide_proposal`, `playground_test`, …).
Everything built so far **reacts to assets that already exist**: it diagnoses, classifies,
and resolves. Two things the system never does, both mapping to recognised open SPL
research problems:

- **C — it never *fills* the test gaps it finds.** `line-health` already computes
  `riskyUncoveredPairs` (feature pairs no product has ever co-selected) and then stops.
  The SPL combinatorial-interaction-testing literature (Kuhn04, Perrouin10, Johansen12,
  Henard14) generates t-wise covering arrays but almost never *executes* them — papers
  lack a derivation engine and runnable products. **LINEA has both** (`spl-js-engine`
  derivation + `PlaygroundService` Docker runner), so it can go all the way to
  *running the missing configurations and surfacing real interaction faults* — a
  contribution the field structurally can't easily make.

- **D — the SPL has no living, trustworthy documentation.** Generic LLM doc-gen is
  ungrounded. The research contribution is a **continuously-maintained, traceable,
  execution-verified variability handbook** where every claim is backed by a
  deterministic source (FM analysis, feature-location footprint, coverage matrix, and
  **C's executed test results**), not LLM prose.

**Unified narrative: a self-documenting, self-verifying SPL.** C produces the verified
testing status; D consumes it as one of its grounded sections. Each is publishable
alone; together they're one story.

This plan honours LINEA's load-bearing principle — *every agent names a deterministic
core and re-validates anything the LLM proposes against it.*

## Architecture — external agents, in-server primitives

The C/D **agents run outside LINEA** and drive everything through the MCP (the
"external agents using the MCP" thesis). We add the few **in-server primitives** that
genuinely must be server-side because they own a deterministic core, the execution
engine, or git host credentials. The external runner is a small Node/TS app using the MCP
SDK client + the Anthropic SDK tool-use loop (LangGraph optional later for the durable
continuous loop — same reasoning the ecosystem-plan applied to the Batch Orchestrator).

```
 EXTERNAL (new package, consumes MCP)        IN-SERVER (new primitives, reuse cores)
 ────────────────────────────────────        ───────────────────────────────────────
 C  Variant Test Pilot ──────────────▶  splalm_get_coverage            (fmAnalysis.js)
    covering array → run → minimise ──▶  splalm_generate_covering_array (fmAnalysis.js, NEW)
    → narrate faults                  ──▶  splalm_test_configuration      (PlaygroundService, NEW)
        │  writes results (AgentMemory + run result)
        ▼
 D  Handbook Curator ────────────────▶  splalm_launch_agent('feature-location')  (exists)
    assemble grounded sections        ──▶  splalm_analyze_feature_model / get_spl_info (exist)
    → publish                         ──▶  splalm_publish_wiki            (gitlabClient, NEW)
        ▲
 Continuous loop (schedule / FM-change): run C → run D → publish wiki
```

## Part 1 — In-server primitives (small, high-reuse additions)

### 1a. FM-constrained covering-array generator — `server/src/agents/tools/fmAnalysis.js`
Add `generateCoveringArray({ model, fmFeatures, productFeatureSets, t = 2 })`:
- Reuse existing `computePairCoverage` to find already-covered pairs and the uncovered
  set (same computation `lineHealthAgent.analyse` already does for `riskyUncoveredPairs`).
- Greedily build a minimal set of **valid** configurations covering the uncovered
  t-tuples, validating/completing each candidate with `model.completeFeatureSelection`
  (the deterministic validity core — guarantees every proposed config is buildable).
- Return `{ configs: [{ features, newlyCoveredPairs }], remainingUncovered }`.
This is the Perrouin/Johansen "t-wise from a feature model" core, kept deterministic and
in-server. Pure function (no LLM, no git host), consistent with the rest of `fmAnalysis.js`.

### 1b. Standalone derive-and-test — `server/src/agents/playground/PlaygroundService.js`
Add `testConfiguration({ userId, baseProductId, featureSelection })`:
- Mirror the existing silent `testFileEdits` / `#prepareWorkspace` path: download the
  base product at its default branch, derive the **line** with `featureSelection`
  (this is where annotation-driven, feature-conditional tests appear), merge onto the
  product scaffold (`overrideWithLineChanges: true`), then run the product's configured
  test command/image in Docker via the existing `#runInDocker`.
- Return `{ passed, exitCode, log }` — same shape as `testFileEdits`.
- **Not gated behind a paused run** (today's `runProductTest` requires a `runId`/
  `fm_patch` proposal). Decouple by reusing `#prepareWorkspace` with `proposal = null`.
- Expose a thin endpoint in `agentRouter.js` (e.g. `POST /api/agents/test-configuration`)
  reusing `productGitlabAccess` for authz (access level 20 on the base product).

### 1c. git host wiki wrapper — `server/src/model/connectors/gitlabClient.js`
Add `getWikiPage` / `upsertWikiPage(token, projectId, slug, title, content)` thin
`appFetch` wrappers over `GET/POST/PUT /projects/:id/wikis`. Expose via
`agentRouter.js` (`PUT /api/agents/wiki`) with line access-level 30.

### 1d. New MCP tools — `splalm-mcp/src/tools/agents.ts` (+ enum/registration)
- `splalm_get_coverage` → wraps a lean read of the coverage computation (or
  `launch_agent('line-health')` result) returning covered/uncovered pairs + percentages.
- `splalm_generate_covering_array` → wraps 1a.
- `splalm_test_configuration` → wraps 1b.
- `splalm_publish_wiki` → wraps 1c.
All four follow the existing `registerTool` + `handleApiError` + `toStructured` pattern
in `agents.ts`; honour `MCP_READ_ONLY` for the two write-ish ones (`test_configuration`
runs containers; `publish_wiki` writes git host).

## Part 2 — Agent C: Variant Test Pilot (external)

**Goal:** turn `line-health`'s uncovered-pair *report* into discovered *faults*.

Pipeline (external tool-use loop over the MCP):
1. **gaps** — `splalm_get_coverage` → uncovered, FM-valid feature pairs (risk-ordered by
   per-feature frequency, as `lineHealthAgent` already orders them).
2. **plan** — `splalm_generate_covering_array` → minimal set of valid configs covering
   the gaps (pick a representative `baseProductId` for the scaffold — default: the
   product whose feature set is closest to each config to minimise merge surprises).
3. **execute** — for each config: `splalm_test_configuration` → `{ passed, log }`.
4. **minimise** *(the novelty)* — for each failing config, delta-debug the feature set
   (drop features, re-run `test_configuration`) to isolate the **minimal failing feature
   interaction** ("the culprit is the pair (Backup, PdfExport)"). Deterministic shrink;
   the LLM only explains.
5. **narrate + persist** — LLM writes a fault report; store structured results as the run
   result **and** a line-scoped `AgentMemory` fact (via `splalm_list_memory`'s backing
   write path) so D and future runs can read "verified pairs / known interaction faults".

**Deterministic cores:** `completeFeatureSelection` (config validity), `computePairCoverage`
(gap detection), the covering-array builder, and the actual exit code of the test run.
The LLM never decides pass/fail.

**Evaluation (research):** pairs covered before/after, configs needed (covering-array
size vs brute force), interaction faults found, wall-clock/cost per gap closed.

## Part 3 — Agent D: Handbook Curator (external)

**Goal:** a continuously-maintained, traceable, execution-verified SPL handbook on the
git host wiki. Each section names its deterministic source (the traceability contribution):

| Section | Grounded source (via MCP) |
|---|---|
| Overview / domain | `splalm_get_spl_info` |
| Feature catalog (core/dead/false-optional) | `splalm_analyze_feature_model` |
| Variability profile (configs#, variability, homogeneity) | `splalm_analyze_feature_model` |
| Feature → code map | `splalm_launch_agent('feature-location')` per feature → footprint markdown |
| Product portfolio | `splalm_list_products` + specs |
| **Coverage & verification status** | `splalm_get_coverage` + **C's latest results** (tested pairs, pass/fail, known interaction faults) |

Pipeline: gather sources → LLM composes prose **constrained to the deterministic data**
(no claim without a backing source; every footprint/coverage figure cited) →
`splalm_publish_wiki` upserts the `SPL-Handbook` page. Re-running overwrites the page,
so it stays live.

**Evaluation (research):** traceability coverage (% of claims linked to a deterministic
source), staleness (page vs current FM/portfolio), and the novelty of the
*execution-verified* section (docs that report what was actually run, not just what's
configurable).

## Part 4 — Continuous-maintenance loop + C↔D coupling

- **Coupling is loose:** C writes its results to its run result + an `AgentMemory` fact;
  D reads the latest via the MCP. D never triggers C inline.
- **The loop** (the "continuously-maintained" property, and the genuinely external
  composer): a scheduled external runner that, on a cadence or on an FM/platform-change
  signal, runs C (refresh verification) → runs D (regenerate handbook) → publishes the
  wiki. v1 = cron/`/loop`-style trigger calling the external runner; the existing
  in-server `triggers/scheduler.js` can alternatively emit the change signal.

## Critical files

> **Superseded (2026-06-24):** the external `splalm-variability-agents/` package has been
> removed. The agent system now lives entirely in-server under `server/src/agents/`
> (variant-testing moved into the server pipeline; the Living Handbook idea is tracked in
> `docs/linea/ideas.md`). The note below is kept for historical context only.

**New (external package, e.g. `splalm-variability-agents/`):** the C and D runners + a
small MCP-client bootstrap (MCP SDK `Client` + Anthropic SDK tool loop) + the loop entry.

**Modify (in-server):**
- `server/src/agents/tools/fmAnalysis.js` — add `generateCoveringArray` (reuse `computePairCoverage`).
- `server/src/agents/playground/PlaygroundService.js` — add `testConfiguration` (reuse `#prepareWorkspace` + `#runInDocker`).
- `server/src/model/connectors/gitlabClient.js` — add wiki get/upsert wrappers.
- `server/src/agents/rest/agentRouter.js` (+ `agentController.js`) — endpoints for test-configuration, wiki, and (optionally) a lean coverage read.

**Modify (MCP):**
- `splalm-mcp/src/tools/agents.ts` — register `splalm_get_coverage`,
  `splalm_generate_covering_array`, `splalm_test_configuration`, `splalm_publish_wiki`.
- `splalm-mcp/src/types.ts` — result types for the above.

## Verification (end-to-end)

1. **Primitives:** unit-test `generateCoveringArray` (every returned config passes
   `completeFeatureSelection`; all targeted pairs covered). Call `POST
   /api/agents/test-configuration` for a known-good config → `passed: true`; for a config
   that triggers a seeded interaction bug → `passed: false` with the failing log.
2. **MCP:** from an MCP client, `splalm_generate_covering_array` then
   `splalm_test_configuration` for each → confirm pass/fail + logs; `splalm_publish_wiki`
   writes a page visible in git host.
3. **Agent C:** run the external C runner against a test SPL with a deliberately untested
   pair that breaks → it reports the covering set, the failing config, and the minimised
   culprit pair; results land in the run result + `AgentMemory`.
4. **Agent D:** run D → the wiki `SPL-Handbook` page renders all sections, the
   coverage/verification section reflects C's latest run, and every footprint/coverage
   figure traces to its source. Change the FM, re-run the loop → the page updates.

## Open risks

- **Base-product scaffold choice** affects test realism (a config merged onto a product
  with heavy customisations may fail for non-interaction reasons). Mitigate by picking
  the nearest-feature-set product and reporting the scaffold used; consider a minimal
  "scaffold product" per line later.
- **Cost of minimisation** — delta-debugging re-runs tests; bound the shrink depth and
  cache per-config verdicts.
- **Wiki API scope** — confirm the LINEA service token has wiki write on the line repo.
- **`ai.maxTokens: 4096`** (`properties.yml`) may truncate D's handbook; raise or
  section-stream for the doc agent.
