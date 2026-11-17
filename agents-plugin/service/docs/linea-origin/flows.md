# System Flows

## Round Trip Overview

The flows below cover individual agents in detail. Zoomed out, three of them form a
single loop — a product diverges from the platform, the divergence merges back into
the SPL, and the SPL change propagates back out to every product. The Agents page's
**Flow** tab (`FlowHub.vue`, backed by `flowModel.js`) visualizes exactly this loop as
three linked stage cards, using these same three names:

```
 1. DIVERGENCE ─────────► 2. INTO THE SPL ─────────► 3. PROPAGATION
 What changed in each     How it merges into the      What gets reimplemented in
 product, off the SPL      line                        each product from the SPL
```

| Stage | Driven by | Detail |
|---|---|---|
| 1. Divergence | **Variant Miner** ranks candidate divergences across the whole portfolio (see [agents.md](agents.md#variant-miner)); **Harvest** proposes lifting one product's divergence into the platform | [§4 Harvest Flow](#4-harvest-flow-product--spl) |
| 2. Into the SPL | A Harvest proposal opens an `fm_patch` MR on the line repo; alternatively a **Change Set** version (drafted by chat, a git host branch, or promoted from an accepted harvest) is promoted to a `changeset` run | [§4 Harvest Flow](#4-harvest-flow-product--spl), [§6 Change Set Flow](#6-change-set-flow-co-evolution) |
| 3. Propagation | A Change Set's `cascade` step fans out `evolution` (spec-invalid products) and `regen` children per product; a `regen` that conflicts auto-spawns `sync`. A full-line regen (not tied to a Change Set) uses `line-sync` | [§6 Change Set Flow](#6-change-set-flow-co-evolution), [§3 Sync Flow](#3-sync-flow-spl--product) |

---

## 1. Create a Product

```
User fills in product form (name, feature selection, spec)
    │
    ▼
POST /api/products   (ProductService.createProduct)
    ├── Validate feature selection against line's feature model
    │       completeFeatureSelection(features) — throws 400 on violation
    ├── Save Product to MongoDB
    ├── Create git host group (named after the product) in line's namespace
    ├── Create git host project tagged 'product' in that group
    ├── Create 'bigbang' branch, set 'main' as default
    └── Persist the repository id / webUrl / webIdeUrl on the product
```

**Key constraint:** Feature selection is validated at create AND update time. If the line's feature model is unreadable (git host unavailable), validation is skipped (best-effort).

---

## 2. Generate a Product

Generation pushes the latest SPL platform code + the product's spec into the product repository.

```
User clicks "Generate" on a product
    │
    ▼
POST /api/products/:id/generate   (ProductService.generateProduct)
    ├── Load line platform templates from line repo
    ├── Apply product spec (feature selection, data model, …)
    ├── Commit generated files to the 'bigbang' branch on the product repo
    ├── Open a Merge Request: bigbang → main
    │
    ├─ No conflicts ──────────────────────────────────────────────────► done
    │
    └─ Merge conflicts detected
            │
            ├── Emit PRODUCT_GENERATED domain event (conflicts: true)
            │
            └─► domainSubscriber → AgentRunner.enqueueNew('sync', …)
                    └── Sync Agent starts automatically (see Sync Flow below)
```

**Branch model:**

```
main       ──────────────●──────────────────────────●──────
                         ↑ manual edits              ↑ MR merged
bigbang    ──────────────────●──────────────────────
                              ↑ generated commit
```

The `bigbang` branch always holds the most recently generated code. The `main` branch is what the product team works on. A Merge Request from `bigbang → main` is opened on every generation.

---

## 3. Sync Flow (SPL → Product)

Triggered automatically when `generateProduct` detects conflicts, or manually via the "Diagnose sync" button on ProductDetail.

```
Sync Agent (scope: product)
    │
    ├── [load-context]     Load product logs, check access
    │
    ├── [diagnose]         Classify logs deterministically
    │                         → verdict: { status, stage, diagnosis }
    │                         stage = 'generating' (first gen) | 'update' (re-gen)
    │
    ├── [fetch-conflict-details]  Read the open MR + diff
    │                               Classify each file:
    │                                 'theirs' = generator-owned (safe to take generated)
    │                                 'ours'   = known customization (README, .env, …)
    │                               unambiguous = ALL files are 'theirs'
    │
    ├── [explain]          LLM generates a per-file resolution plan in markdown
    │
    ├── [resolve-edits]    (update stage only) LLM produces reconciled FULL file content
    │                         read_file tool on bigbang + main, propose_resolution tool
    │
    ├── [propose-resolution]
    │       ├── update stage + resolution content
    │       │       → proposal kind='merge_resolution' (blastRadius='product')
    │       │         body includes fileEdits with old/new content for diff review
    │       └── fallback / generating stage
    │               → proposal kind='git_comment' (advisory plan)
    │                 unambiguous=true → may be automatic (see Autonomy)
    │
    └── [apply-resolution]
            ├── merge_resolution approved → commit reconciled files to MR source branch
            │                               (bigbang absorbs main's manual edits)
            │                               → recheckMergeability
            └── git_comment approved  → post plan as MR comment
```

**How to read the review UI:**
- When a `merge_resolution` proposal is awaiting approval, the Agents dialog shows a "Review changes" card
- Click it to open the **Harvest/Sync review dialog**: left panel = file list, right panel = line diff (old = `main`, new = reconciled), bottom panel = refine chat
- Use the refine chat to give feedback; the agent re-runs the LLM resolution loop with your message
- Accept → commits the reconciled files; Reject → cancels the run

---

## 4. Harvest Flow (Product → SPL)

Triggered automatically by a git host push webhook when someone commits directly to `main` on a product repo, or manually via the "Harvest" button on ProductDetail.

```
Developer commits directly to product's main branch
    │
    ▼  (git host fires push webhook)
git:pushed (LINEA → POST /api/events, signed with EVENT_WEBHOOK_SECRET)
    ├── Verify X-Linea-Signature
    ├── Filter: push to 'main' only
    ├── Find product by repository id
    ├── Resolve user (push author's username → LINEA user → fallback to line.ownerId)
    ├── Guard: skip if active harvest run already exists for this product
    └── AgentRunner.enqueueNew('harvest', …)
            │
            ▼
Harvest Agent (scope: product)
    │
    ├── [detect-changes]   compareBranches(bigbang → main)
    │                       → files changed beyond generated baseline
    │                         (if empty → run finishes as no-op)
    │
    ├── [propose-plan]     LLM tool loop (maxTurns=12)
    │                         Tools: list_platform_files, read_platform_file, propose_harvest
    │                         Output: featureName, newModelUvl, fileEdits[{path, action, newContent, oldContent}]
    │
    ├── [validate-fm]      deterministic: completeFeatureSelection(newModelUvl) for EVERY product
    │                         → { valid, broken[] }
    │                         Blocked if any product breaks
    │
    ├── [propose-harvest]  proposal kind='fm_patch' (blastRadius='line' — always awaits human)
    │                         body: FM diff + platform file edits (old + new content)
    │
    └── [open-mr]          On approval:
                               createBranch on line repo
                               commit(model.uvl + all fileEdits) in one commit
                               createMergeRequest bigbang→main on line repo
                               postMergeRequestComment with plan markdown
```

**What the proposal contains:**
- Feature model diff (old UVL vs. new UVL with the new optional feature added)
- Per-file diffs for each platform file the LLM wants to edit
- The full refine chat to iterate on the proposal before accepting

**Safety posture:**
- FM change is validated deterministically — if it would break any existing product, the run is blocked (no MR opened)
- Platform code changes go into an MR on the line repo (not merged) — the git host MR diff is the human review gate
- Blast radius is always `'line'`, so the approval gate always requires human action regardless of autonomy settings

---

## 5. Evolution Flow

Triggered when the feature model changes and some products have invalid feature selections, or from FeatureModelEditor's "Preview impact" button.

```
Evolution Agent (scope: line, input.mode = 'migration' | 'impact')
    │
    ├── [scan]             All products → completeFeatureSelection each
    │                         migration mode: finds invalid products
    │                         impact mode:   compares current vs. proposed model,
    │                                        classifies each product as breaking/fixing/unaffected
    │
    ├── [propose-fixes]    LLM: given invalid products + full feature list → minimal spec patches
    │
    ├── [validate-fixes]   deterministic re-validation of each proposed patch
    │
    ├── [propose-apply]    proposal kind='spec_patch' (blastRadius='product')
    │                         impact mode → advisory only (no proposal, read-only result)
    │
    └── [apply-fixes]      On approval: ProductService.updateProduct per patched product
```

---

## 6. Change Set Flow (Co-Evolution)

Not in the original 6 flows above, and not covered in [agents.md](agents.md) either —
the `changeset` agent (line scope, title "Co-Evolution Change Set") is the largest
agent in the system (11 steps) and the primary way stage 2 → stage 3 of the
[Round Trip](#round-trip-overview) happens today.

**The durable entity is a `ChangesetVersion`, not a bare run.** Each version owns a
`plan/vX.Y-<slug>` git host branch and a persistent chat; a run only exists once a
version is **promoted**. Versions form a tree (`parentVersionId`), numbered `epoch.minor`
— forking keeps the parent's epoch and bumps `minor`; a fresh root after any merge in
the line bumps `epoch`. **Merging one version closes its whole epoch**: every sibling
version at that epoch is locked from promotion (only a later epoch stays open) —
`ChangesetVersionService.promoteToPlan` enforces this server-side, and
`CoEvolutionConsole.vue`'s `selectedVersionLocked` mirrors it in the UI.

A version is created four ways: **New version** (root, from `main`), **Fork** off an
existing version, **From branch** / **Propose with AI** (both seed the version from a
specific git host branch instead of `main` — `origin: 'root'` and `'llm'` respectively),
or by promoting an in-review Harvest proposal via `POST /runs/:id/to-changeset`
(`origin: 'harvest'`). See [architecture.md](architecture.md#changesetversion) for the
full `origin` enum.

```
ChangesetVersion (draft) ── user iterates in chat / sandbox ──► Promote
    │
    ▼
changeset AgentRun (scope: line)
    │
    ├── [plan]                deterministic — classifies the FM/platform edit
    │                           (refactoring / generalization / specialization /
    │                            arbitrary) and partitions every product into
    │                            migrate / regen / skip / likely-conflict
    │
    ├── [approve-plan]        approval — edit class + per-product action table;
    │                           operator picks the autonomy mode (manual / semi / auto)
    │
    ├── [sandbox]             approval — optional pre-merge iteration: edit the FM
    │                           and annotated platform code on the plan/ branch,
    │                           preview impact via the playground. Skipped in
    │                           automatic mode or with no working branch
    │
    ├── [merge-branch]        git — merges plan/ → main on the line repo,
    │                           invalidates the FM cache
    │
    ├── [propagate-features]  deterministic — for every product marked Include,
    │                           adds each new optional feature into spec.features
    │                           (code is feature-gated; a product must opt in)
    │
    ├── [cascade]             deterministic — fans out one child run per product:
    │                           evolution (spec-invalid) or regen (regen-needed),
    │                           each with its resolved autonomy. A regen that
    │                           conflicts auto-spawns sync                        ◄── stage 3
    │
    ├── [verify]              deterministic — aggregates every child outcome
    │
    ├── [test]                playground — runs every affected product's real test
    │                           suite against post-cascade main; persists TestResult.
    │                           Generalization edits with new features also get
    │                           1-wise interaction testing
    │
    ├── [approve-tests]       approval — semi-auto approves on all-green, pauses on
    │                           any failure; automatic always advances; manual always
    │                           pauses
    │
    ├── [deploy]               git — merges each selected product's bigbang → main
    │                           (the "publish this regen live" step); per-product
    │                           failures land in the ledger for individual retry
    │
    └── [record]               deterministic — writes an AgentMemory fact (edit
                                class, autonomy, cascade + test outcomes) for future
                                plans to recall
```

**Step kinds** here follow the same taxonomy as every other agent
([agents.md](agents.md#step-kinds)), plus one more: `playground` (the `test` step) —
runs a real test suite in a Docker sandbox rather than calling git host or an LLM.

---

## 7. Knowledge Chat

Not a run-step agent — a multi-turn LLM tool loop backed by persistent threads.

```
POST /api/agents/knowledge/message  { lineId, threadId?, content }
    │
    ▼
KnowledgeService.ask
    ├── Load or create AgentThread
    ├── Rebuild conversation history from AgentMessage records
    ├── runToolLoop over read-only tools:
    │       list_products   → scanProducts(lineId)
    │       get_feature_model → loadFeatureModel(lineId)
    └── Persist user + assistant messages → return response
```

Available from the chat panel on LineDetail.
