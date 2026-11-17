# Research Gaps and Proposed Agents

This document maps open research problems in Software Product Lines (SPL) to concrete
agent ideas for LINEA, annotated with the academic literature that motivates each gap.

The agents described here extend the current agent ecosystem (Line Health, Sync, Harvest,
Evolution, FM Constraint Advisor, Feature Location, Variant Miner) with capabilities the
system has no answer to. The final section grounds the **agent-memory RAG subsystem** —
the cross-run learning mechanism shared by all of these agents — in the retrieval and
memory-augmentation literature.

---

## Background: Canonical SPL References

The following works form the theoretical backbone of SPL engineering and are cited
throughout this document:

- **[Clements01]** Clements, P., Northrop, L. (2001). *Software Product Lines: Practices
  and Patterns*. Addison-Wesley.
- **[Pohl05]** Pohl, K., Böckle, G., van der Linden, F.J. (2005). *Software Product Line
  Engineering: Foundations, Principles and Techniques*. Springer.
- **[Apel13]** Apel, S., Batory, D., Kästner, C., Saake, G. (2013). *Feature-Oriented
  Software Development*. Springer.
- **[FODA90]** Kang, K.C., Cohen, S.G., Hess, J.A., Novak, W.E., Peterson, A.S. (1990).
  *Feature-Oriented Domain Analysis (FODA) Feasibility Study*. CMU/SEI-90-TR-021,
  Software Engineering Institute. — The paper that introduced feature models.
- **[Benavides10]** Benavides, D., Segura, S., Ruiz-Cortés, A. (2010). "Automated
  Analysis of Feature Models 25 Years Later: A Literature Review." *Information Systems*,
  35(6), 615–636. — The definitive survey of FM analysis; covers dead features, false
  optional, void models, and configuration counting. Central reference for agents B and C.

---

## Agent A — Configuration Coverage Agent

### The Problem

An SPL with n optional features has up to 2ⁿ valid configurations, but a real product
portfolio covers only a tiny fraction of them. The gap between *valid* configurations
(permitted by the feature model) and *tested* configurations (covered by at least one
deployed product) is the single most persistent source of latent defects in SPL-managed
systems.

The literature distinguishes three coverage levels:

1. **1-wise (feature coverage):** Every individual optional feature is selected by at
   least one product.
2. **2-wise / pair-wise:** Every pair of features (A selected, B selected) that is valid
   under the FM is covered by at least one product.
3. **t-wise:** Generalization to t-tuples. Empirical studies show that most interaction
   faults involve ≤ 6 factors, making t ≤ 6 sufficient for practical test suites.

The problem in LINEA: `completeFeatureSelection` validates each product individually,
but no component answers "which feature pairs have never been co-selected by any product
in this line?" That question is what drives test gap identification and risk assessment.

### Key References

- **[Kuhn04]** Kuhn, D.R., Wallace, D.R., Gallo, A.M. (2004). "Software Fault
  Interactions and Implications for Software Testing." *IEEE Transactions on Software
  Engineering*, 30(6), 418–421.
  — Foundational empirical study showing that 70–99% of faults involve interactions
  between at most 6 factors. Justifies t-wise sampling as sufficient coverage strategy.

- **[Cohen97]** Cohen, D.M., Dalal, S.R., Fredman, M.L., Patton, G.C. (1997). "The AETG
  System: An Approach to Testing Based on Combinatorial Design." *IEEE Transactions on
  Software Engineering*, 23(7), 437–444.
  — Introduced the AETG tool, one of the first automated pair-wise test case generators.
  Establishes the algorithmic foundations for combinatorial interaction testing (CIT).

- **[Perrouin10]** Perrouin, G., Sen, S., Klein, J., Baudry, B., Le Traon, Y. (2010).
  "Automated and Scalable T-wise Test Case Generation Strategies for Software Product
  Lines." *Proceedings of ICST 2010*.
  — Adapts CIT specifically to SPL feature models; the key result is that pair-wise
  coverage with FM constraints is tractable even for large models.

- **[Johansen12]** Johansen, M.F., Haugen, Ø., Fleurey, F. (2012). "An Algorithm for
  Generating T-Wise Covering Arrays from Large Feature Models." *Proceedings of SPLC
  2012*.
  — Practical algorithm for generating minimal t-wise test configurations directly from
  a feature model; the covering-array framing maps naturally onto the product portfolio.

- **[Henard14]** Henard, C., Papadakis, M., Harman, M., Jia, Y., Le Traon, Y. (2014).
  "Bypassing the Combinatorial Explosion: Using Similarity to Generate and Prioritize
  T-Wise Test Configurations for Software Product Lines." *IEEE Transactions on Software
  Engineering*, 40(7), 650–670.
  — Similarity-based prioritization of t-wise test suites; particularly relevant for
  reporting WHICH gaps are most dangerous (configurations most different from existing
  products).

- **[Benavides10]** (see above) — Section 4 covers configuration counting and covers
  the FM analysis operations (counting, enumeration, uniform sampling) that underpin
  this agent's deterministic core.

### What Exists in LINEA Today

`spl-js-engine`'s `completeFeatureSelection` validates a single product spec against the
FM. `scanProducts` in `tools/splContext.js` runs it across all products and reports
valid/invalid. No component computes cross-product coverage or identifies untested pairs.

### Agent Design

**Type:** `coverage-analysis` | **Scope:** line | **Trigger:** manual / scheduled
**Blast radius:** read-only — no writes, no git host access, no approval gate needed.

**Steps:**

1. **load-model** — `loadFeatureModel` parses the UVL/XML FM. Extract the list of all
   optional features (leaves + non-mandatory groups).

2. **scan-products** — `scanProducts` collects each product's resolved feature selection
   (the set of features that `completeFeatureSelection` resolves to selected).

3. **compute-coverage** *(deterministic core)* —
   - 1-wise: which optional features are selected by at least one product?
   - 2-wise: enumerate all valid pairs under the FM (via FM constraint propagation or
     simple product set intersection); for each pair, is it covered?
   - Dead features: features that appear in the FM but no product ever selects.
   - Zombie optionals: features declared Optional but selected by 100% of products
     (effectively mandatory; FM is inaccurate).
   - Always-co-selected pairs: features that are ALWAYS selected together (candidate for
     merge or explicit FM constraint).

4. **narrate** *(LLM)* — Given the coverage matrix, generate:
   - A risk-ordered list of uncovered pairs ("Feature A + Feature B have never been
     co-selected; both touch `transformation.js` at the platform level").
   - Recommended new product configurations that would maximize coverage gain.
   - FM accuracy issues (dead / zombie features) with suggested FM edits.

**Output shape:**

```json
{
  "coverage1Wise": { "total": 12, "covered": 10, "dead": ["featureX"] },
  "coverage2Wise": { "total": 66, "covered": 41, "uncoveredPairs": [["A","B"], ...] },
  "zombieOptionals": ["featureY"],
  "alwaysCoSelected": [["P","Q"]],
  "recommendations": "..."
}
```

**Deterministic invariant:** Coverage counts and pair sets are computed entirely by
set arithmetic over product feature lists — LLM is only used for the narrative. The
LLM cannot hallucinate a covered pair that isn't in the data.

---

## Agent B — Feature Location Agent

### The Problem

Feature location is the task of identifying which source code artefacts (files,
functions, blocks) implement a given feature named in the feature model. In a growing
SPL platform (`extra.js`, `transformation.js`, templates), this link is implicit: there
is no annotation, no `#ifdef`, no explicit mapping. As the platform grows, a developer
wanting to change "Feature X" has no way to know which functions to read, which products
to re-test, or what downstream effects to expect — short of reading the entire platform
codebase.

This is a well-studied, open problem. Automated approaches fall into three families:

1. **Dynamic analysis** — run products with/without a feature, diff execution traces.
2. **Static / IR-based** — text similarity between feature names/descriptions and
   identifier names, comments, or structural patterns in code (LSI, VSM, LDA).
3. **Hybrid** — combine static + dynamic signals, or use program slicing.

LINEA's position is unusual: because it *generates* products, it can execute a
novel variant of dynamic analysis that the literature doesn't have — run
`completeFeatureSelection` with and without a feature → diff the *generated output*.
That diff is an exact, deterministic feature-to-output map with zero instrumentation cost.

### Key References

- **[Eisenbarth03]** Eisenbarth, T., Koschke, R., Simon, D. (2003). "Locating Features
  in Source Code." *IEEE Transactions on Software Engineering*, 29(3), 210–224.
  — The seminal feature location paper. Combines dynamic analysis (execution traces,
  Formal Concept Analysis) with static call graphs. Established the problem framing
  used by virtually all subsequent work.

- **[Dit13]** Dit, B., Revelle, M., Gethers, M., Poshyvanyk, D. (2013). "Feature
  Location in Source Code: A Taxonomy and Survey." *Journal of Software: Evolution and
  Process*, 25(1), 53–95.
  — Comprehensive taxonomy of 60+ feature location techniques. The taxonomy distinguishes
  static/dynamic/IR-based/combination approaches and defines the evaluation criteria
  (precision, recall against manually labelled ground truth).

- **[Marcus04]** Marcus, A., Rajlich, V. (2004). "The Use of IR Methods for
  Identification of Feature Descriptions and Locations." *Proceedings of ICPC 2004*.
  — Introduced LSI (Latent Semantic Indexing) for feature location; the approach of
  matching natural-language feature descriptions to source code identifiers is the
  closest analogue to what an LLM can do in a zero-instrumentation setting.

- **[Rubin13]** Rubin, J., Chechik, M. (2013). "A Survey of Feature Location
  Techniques." In *Domain Engineering* (pp. 29–58). Springer.
  — Survey chapter framing feature location in the SPL context specifically (rather than
  the general program comprehension context of [Eisenbarth03]).

- **[Linsbauer13]** Linsbauer, L., Lopez-Herrejon, R.E., Egyed, A. (2013). "Recovering
  Feature-to-Code Mappings in Mixed-Variability Software Systems." *Proceedings of ICSM
  2013*.
  — Focuses on systems that mix compile-time and runtime variability (exactly LINEA's
  case: UVL FM + runtime platform code); the recovery algorithm is a direct precedent
  for the differential analysis step below.

- **[Biggerstaff93]** Biggerstaff, T.J., Mitbander, B.G., Webster, D.E. (1993).
  "Program Understanding and the Concept Assignment Problem." *Communications of the
  ACM*, 36(5), 72–82.
  — Early framing of "concept assignment" (mapping domain concepts to code) as a
  distinct program understanding problem. Predates feature models but defines the
  intellectual lineage of feature location.

- **[Benavides10]** (see above) — The "FM analysis" operations (configuration
  enumeration, variant derivation) that this agent's deterministic core relies on.

### What Exists in LINEA Today

`extractDefinedFunctions` (regex, 5 JS patterns) + `closestMatch` (Levenshtein on
function names) in `tools/platform.js`. Platform Doctor uses these to diagnose a
*named* function. There is no mechanism to go the other direction: given a *feature
name*, find the functions.

### Agent Design

**Type:** `feature-location` | **Scope:** product (needs a product to derive against)
or line (with a dummy product) | **Trigger:** manual, input: `featureName`
**Blast radius:** read-only — no writes, no approval gate.

**Steps:**

1. **load-context** — `loadFeatureModel`, `scanProducts` (to find products that DO and
   DON'T select the target feature), `listPlatformFiles` + `readRepoFile` for full
   platform source.

2. **differential-derivation** *(deterministic core)* —
   Find the product that most closely matches a "minimal" configuration (fewest features)
   that still includes the target feature. Run `completeFeatureSelection` for:
   - Config WITH the feature
   - Config WITHOUT the feature (if valid under FM constraints)
   - Diff the two generated outputs → the changed sections are the *implementation
     footprint* of the feature in the generated product.

3. **static-semantic-scan** *(LLM tool loop)* —
   Using `read_platform_file` tools, LLM reads platform source and identifies:
   - Functions whose names, parameters, or comments reference the feature name or its
     synonyms (IR-based approach, [Marcus04]).
   - Conditional branches that appear to gate on feature-related flags or inputs.
   - Template blocks that are skipped or rendered conditionally.

4. **reconcile** *(LLM)* — Merge the differential signal (step 2) with the semantic
   signal (step 3) into a ranked feature map:
   ```
   Feature: <name>
   Confidence: HIGH/MEDIUM/LOW
   Platform files:
     - extra.js: generateX() [differential+semantic], maybeY() [semantic only]
     - transformation.js: applyZ() [differential only]
   Generated output sections:
     - src/services/<name>/ [differential]
   Recommendation: "When changing this feature, review generateX first..."
   ```

5. **propose-annotation** *(optional, approval gate)* —
   If `input.annotate === true`, propose adding a JSDoc `@feature <name>` annotation
   above each identified function — as a git host MR on the line repo. This creates a
   persisted machine-readable feature map that future runs can read directly, gradually
   eliminating the need for inference.

**Key insight vs. the literature:** Steps 1–2 are a zero-cost dynamic analysis that
is only possible because LINEA generates products. Traditional feature location
([Eisenbarth03]) requires running instrumented programs; here, `completeFeatureSelection`
is the "execution." The LLM provides the semantic layer ([Marcus04]) at no extra
instrumentation cost.

**Memory integration:** After each run, `MemoryService.captureRunOutcome` stores the
feature map as a `fact` in `AgentMemory` for the line scope, so future Harvest and
Evolution runs can inject "known feature locations" into their system prompts.

---

## Agent C — FM Health Agent

### The Problem

Feature models accumulate structural problems over time as products are added, features
are extended, and constraints are modified without global review. The literature calls
these **feature model anomalies** (Benavides et al.) or, by analogy with code quality,
**variability smells**. They fall into two categories:

**FM-level anomalies** (detectable via automated FM analysis):
- **Dead feature:** A feature that appears in the FM but can never be selected in any
  valid configuration (e.g., a constraint `requires B` where B is excluded by something
  else). No valid product can ever include it.
- **False optional:** A feature is declared Optional but must be selected in every valid
  configuration (effectively mandatory — the FM is inaccurate).
- **Void model:** No valid configuration exists at all (the FM is unsatisfiable).
- **Redundant constraint:** A cross-tree constraint that is already implied by the
  FM tree structure — adds noise, no semantic content.

**Portfolio-level anomalies** (detectable by comparing the FM to the actual product set):
- **Zombie optional:** A feature is Optional in the FM, and valid configurations exist
  without it, but every *actual* product selects it. The FM permits freedom that no
  product uses — possibly the FM should make it mandatory, or a new product should
  exercise the without-it path.
- **Stranded feature:** A feature is valid and Optional, but no product ever selects it.
  Different from a dead feature (which is never valid); a stranded feature is valid but
  simply unused. Either the feature is vestigial or no product has been created to
  exercise it.
- **Coupling smell:** Two features are always co-selected across all products. They may
  have an undeclared `requires` dependency, or they should be merged into a single
  feature.

These anomalies degrade the FM's role as an authoritative variability specification.
They also create test gaps (stranded features) and mislead developers about which
configurations are actually deployed.

### Key References

- **[Benavides10]** Benavides, D., Segura, S., Ruiz-Cortés, A. (2010). (see above)
  — Sections 3–4 define dead features, false optional, void models, redundant
  constraints, and counting/enumeration as the core FM analysis operations. This is
  the primary reference for all FM-level anomalies.

- **[Mendonca09]** Mendonca, M., Wasowski, A., Czarnecki, K. (2009). "SAT-based
  Analysis of Feature Models is Easy." *Proceedings of SPLC 2009*.
  — Shows that FM analysis (dead features, false optional, void models) reduces to SAT
  in polynomial time for typical FM structures. The practical implication: these checks
  are tractable without specialized solvers — a simple constraint propagation pass over
  the UVL tree suffices for the cross-tree constraints LINEA uses.

- **[Thum09]** Thüm, T., Batory, D., Kästner, C. (2009). "Reasoning about Edits to
  Feature Models." *Proceedings of ICSE 2009*.
  — Formalises the *impact* of FM edits (add/remove feature, tighten/loosen constraint)
  on the set of valid configurations and on existing products. Directly motivates the
  Evolution agent and underpins the FM Health agent's "what changed since last run?"
  comparison.

- **[Thum14]** Thüm, T., Kästner, C., Benduhn, F., Meinicke, J., Saake, G., Leich, T.
  (2014). "FeatureIDE: An Extensible Framework for Feature-Oriented Software
  Development." *Science of Computer Programming*, 79, 70–85.
  — FeatureIDE is the reference implementation of FM analysis in an IDE; its anomaly
  detection capabilities (dead features, false optional, void models via constraint
  propagation) define the state of practice this agent should match or exceed.

- **[Clements01]** (see above) — Chapter 3 discusses feature model maintenance and
  the organizational discipline required to keep the FM accurate as the SPL evolves.
  The portfolio-level anomalies defined above (zombie, stranded, coupled features)
  are the automated counterpart to the manual FM review process Clements & Northrop
  recommend.

- **[Benavides07]** Benavides, D., Trinidad, P., Ruiz-Cortés, A. (2007). "Using
  Constraint Programming to Reason on Feature Models." *Proceedings of SEKE 2007*.
  — Earlier work formalizing FM analysis via constraint satisfaction; useful context
  for implementing the anomaly detection without an external SAT solver.

### What Exists in LINEA Today

Steward agent detects MR-level anti-patterns (open conflict MRs, stale generation
branches). Evolution agent detects products that are invalid against the current FM.
Neither component analyses the FM structure itself, nor compares it to the portfolio
to identify zombie/stranded/coupled features.

### Agent Design

**Type:** `fm-health` | **Scope:** line | **Trigger:** manual / scheduled
**Blast radius:** read-only — no writes, no approval gate needed. (A follow-up
Evolution run or manual FM edit handles any remediation.)

**Steps:**

1. **load-fm** — `loadFeatureModel` parses the UVL/XML. Extract: all features with
   their cardinality (mandatory/optional/or/alternative), all cross-tree constraints.

2. **scan-portfolio** — `scanProducts` collects every product's resolved feature
   selection (the set returned by `completeFeatureSelection`).

3. **fm-anomaly-check** *(deterministic core — FM-level)* —
   For each optional feature F:
   - Attempt `completeFeatureSelection` on a minimal spec `{features: [F]}`:
     - Fails with FeatureSelectionError → F is **dead** (cannot be validly selected).
   - Attempt `completeFeatureSelection` on a spec that explicitly excludes F:
     - Fails → F is **false optional** (exclusion is impossible, always selected).
   - Check cross-tree constraints: for each `A requires B`, verify B is reachable
     from an otherwise-minimal configuration including A.

4. **portfolio-anomaly-check** *(deterministic core — portfolio-level)* —
   - **Stranded features:** features present in FM but in zero product feature sets.
   - **Zombie optionals:** Optional features selected by 100% of products.
   - **Coupling smells:** pairs (A, B) that are always co-selected (Jaccard similarity
     = 1.0 across all products selecting either).
   - **Coverage ratio:** 1-wise and 2-wise coverage percentages (delegates to the
     Coverage Analysis agent's computation if it has been run; otherwise computes inline).

5. **narrate** *(LLM)* — Generates a structured health report:
   - **Red** (action required): dead features, false optionals, void model.
   - **Amber** (review recommended): zombie optionals, stranded features.
   - **Green** (informational): coupling pairs, coverage gaps.
   - Suggested remediation: which FM edits would fix each red/amber issue, and whether
     the fix would invalidate any existing product.

**Output shape:**

```json
{
  "fmAnomalies": {
    "dead": ["featureX"],
    "falseOptional": ["featureY"],
    "voidModel": false
  },
  "portfolioAnomalies": {
    "stranded": ["featureZ"],
    "zombieOptional": ["featureW"],
    "couplingSmells": [["A", "B"]]
  },
  "coverage": { "1wise": 0.83, "2wise": 0.62 },
  "report": "..."
}
```

**Steward integration:** FM Health can be called as a sub-step from the Steward
agent's digest, adding an "FM health" section to the weekly summary with just the
red/amber counts and a link to the full run.

---

## Implementation Order and Shared Infrastructure

```
A (Coverage Analysis)   → no new tools; pure set arithmetic over existing scanProducts output
B (Feature Location)    → new differential derivation step; new tool readGeneratedOutput or
                          compareGeneratedConfigs; reuses listPlatformFiles + readRepoFile
C (FM Health)           → no new tools; reuses loadFeatureModel + scanProducts;
                          adds anomaly-check helpers in tools/fmAnalysis.js
```

**A before B:** Coverage analysis produces the feature-pair matrix that Feature Location
uses to identify which features are most urgent to locate (uncovered pairs first).

**A and C share a deterministic core:** Both call `completeFeatureSelection` in batch.
Consider a shared `tools/fmAnalysis.js` that exports `computeCoverage` and
`detectAnomalies` so neither agent duplicates the enumeration logic.

**Memory integration for all three:** Each run writes to `AgentMemory` at the line
scope. Harvest and Evolution agents will automatically pick up "known dead features"
or "known coverage gaps" via the memory injection in `llm.js`'s `buildSystem()`.

---

## Agent Memory as Retrieval-Augmented Generation

### The Problem

The agents above each run as isolated, stateless episodes: a Sync run that resolved a
tricky conflict last week teaches nothing to the Sync run firing today. Classical SPL
tooling has no notion of cross-run learning at all — FeatureIDE ([Thum14]) and automated FM
analysis ([Benavides10]) are pure functions of the model and the products, with no memory of
the decisions an engineer made. Yet much of the value in operating an SPL is exactly that
accumulated judgement: *which* products are critical, *which* conflicts are safe to
auto-resolve, *which* coupling smells were deliberately left un-encoded.

LINEA closes this gap with a **retrieval-augmented memory**: every decision, run outcome,
and human note is stored and embedded, and each new run is seeded with the most *relevant*
past memories (not merely the most recent) injected into the LLM system prompt. This turns a
stateless agent into one that improves with the line's history. See
[agent-architecture.md](agent-architecture.md) §3 for the implementation.

### Key References

- **[Lewis20]** Lewis, P., Perez, E., Piktus, A., et al. (2020). "Retrieval-Augmented
  Generation for Knowledge-Intensive NLP Tasks." *Proceedings of NeurIPS 2020*.
  — Introduced RAG: conditioning a generative model on documents fetched by a learned
  retriever. LINEA's memory injection is the same pattern with a non-parametric store
  (the `AgentMemory` collection) and an embedding retriever instead of a fine-tuned one.

- **[Karpukhin20]** Karpukhin, V., Oğuz, B., Min, S., et al. (2020). "Dense Passage
  Retrieval for Open-Domain Question Answering." *Proceedings of EMNLP 2020*.
  — Establishes dense vector retrieval (embed query + passages, rank by inner product) as
  superior to sparse lexical matching. LINEA's cosine ranking over TEI embeddings is a
  direct instance; `MIN_SCORE` is the relevance cut-off DPR-style pipelines apply.

- **[Mikolov13]** Mikolov, T., Sutskever, I., Chen, K., Corrado, G., Dean, J. (2013).
  "Distributed Representations of Words and Phrases and their Compositionality."
  *Proceedings of NeurIPS 2013*.
  — Foundational result that semantic similarity is well-approximated by cosine distance in
  a learned embedding space — the assumption underneath the `cosineSimilarity` ranker.

- **[Park23]** Park, J.S., O'Brien, J.C., Cai, C.J., Morris, M.R., Liang, P., Bernstein,
  M.S. (2023). "Generative Agents: Interactive Simulacra of Human Behavior."
  *Proceedings of UIST 2023*.
  — Frames an LLM agent's "memory stream" with relevance-ranked retrieval into the prompt;
  the closest analogue to LINEA's per-run memory recall, including the recency-vs-relevance
  trade-off the threshold and candidate-pool ordering encode.

### What Exists in LINEA Today

`MemoryService` captures `decision`/`fact`/`lesson` memories, embeds them via
`EmbeddingService` (self-hosted HuggingFace TEI), and `AgentRunner.#advance` retrieves the top-K relevant ones
per run through `retrieveRelevant`, injecting them via `llm.js buildSystem()`. Memories are
scoped to a line (optionally a product) and filtered to the running agent's type plus
human-authored `manual` notes. The same retrieval powers a UI recall preview with similarity
scores. See [agents.md](agents.md#agent-memory--rag).

### Open Directions

- **Lesson distillation.** Today `lesson` memories are human-authored. An LLM step could
  periodically distil many low-level `decision`/`fact` rows into a few high-signal lessons
  (memory consolidation, cf. [Park23]'s reflection step) to fight prompt dilution.
- **Cross-scope retrieval weighting.** Product- and line-scoped memories are currently pooled
  by recency before ranking; a learned or heuristic weighting (product memories up-weighted
  for product runs) is an open tuning question.
- **Retrieval evaluation.** There is no ground-truth set for "which past memory should this
  run have recalled," so `MIN_SCORE` and `RAG_K` are set by judgement, not measurement —
  a labelled evaluation set would let these be tuned empirically ([Karpukhin20] methodology).

---

## Related SPL Gaps Not Yet Planned

For completeness, two additional problems from the literature are not addressed by any
current or planned agent:

- **Product Recovery / Clone-and-Own Migration** — bringing an externally developed
  product into SPL management. Key reference: Rubin, J., Chechik, M. (2013). "A
  Framework for Managing Cloned Variants." *Proceedings of AOSD/MODULARITY 2013*.
  Also: Assunção, W.K.G. et al. (2017). "Reengineering Legacy Variants to Software
  Product Lines." *Journal of Systems and Software*, 131, 42–58.

- **Requirements Traceability** — linking FM features to requirements artefacts (issue
  tracker, spec docs). Key reference: Czarnecki, K., Grünbacher, P., Rabiser, R.,
  Schmid, K., Wasowski, A. (2012). "Cool Features and Tough Decisions: A Comparison
  of Variability Modeling Approaches." *Proceedings of VaMoS 2012*.
