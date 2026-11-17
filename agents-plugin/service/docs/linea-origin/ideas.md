 Look at the whole agent roster — sync, harvest, evolution, steward,
  coverage, fm-health, feature-location, platform-doctor. Every one
  of them reacts to assets that already exist: an FM that's written,
  a platform that's authored, products that exist. They diagnose,
  classify, propose patches, resolve conflicts.

  There are three things the system never does, and each is a place a
  new agent could genuinely accelerate development:

  1. It can't build the SPL in the first place (the platform + FM are
  assumed to exist).
  2. It can't write the variable code itself (it proposes patches,
  but a human authors templates).
  3. It identifies test gaps but never fills them (coverage-analysis
  names untested pairs; nothing creates or runs a product to exercise
  them).

  Here's a fresh batch built around those gaps. These are
  deliberately not reshuffles of the last four.

  ---
  A. The SPL Bootstrapper — extractive adoption

  Point an agent at a folder of 3–5 similar apps (the classic "we
  have cloned variants" situation). It diffs them, infers what's
  common vs. variable, drafts a feature model, generates a first
  platform (templatized common core + the variable bits), and creates
  the products in LINEA via the MCP — each one validated by
  deriving it and diffing against the original clone until they
  match.

  Why it's compelling: getting from a pile of clones to an SPL is the
  single biggest barrier to SPL adoption in industry, and an open
  research problem (your research-gaps doc cites Assunção 2017 on
  exactly this). The system today assumes you're already past it.
  This agent is the on-ramp.

  B. The Templatization agent — the domain engineer's hardest task

  The atomic core of A. Hand it one concrete file plus "this part
  should vary on feature X" → it returns the EJS template + any
  extra.js helpers, written in the engine's annotation/delimiter
  syntax, and self-validates by deriving with and without X and
  checking the output. Writing these templates correctly is the one
  expert-only, error-prone task in all of LINEA (your
  missing_function_error failure mode is literally people getting
  this wrong). This is the thing that makes a junior able to author a
  platform.

  C. The Variant Test Pilot — close the testing loop

  coverage-analysis tells you "features A and B have never been
  co-selected." Then nothing happens. This agent takes that gap,
  generates the minimal set of new configurations to cover it,
  derives and runs them through playground_test, and reports the
  actual interaction bugs it found. It turns a coverage report into
  discovered defects. The test infrastructure already exists —
  nothing drives it combinatorially. (Maps to your cited
  Perrouin/Henard t-wise testing work.)

  D. The Living Handbook — the SPL as communicated knowledge

  An agent that generates and continuously maintains a committed SPL
  handbook: a feature catalog with descriptions, a per-feature
  code-location map (feeds on feature-location), a variability guide,
  a "how to add a product" walkthrough — regenerated on every
  FM/platform change so it never goes stale. Documentation is the
  thing every SPL has and none keep current.

  E. The Auto-PR finisher — turn proposals into working code

  Today harvest proposes lifting a customization, but if the lift
  needs real new platform code, a human writes it. This agent takes
  the proposal and actually authors the platform code, opens the MR,
  and iterates the derive→test loop until it's green — going from
  "here's a patch idea" to "here's a merged, working feature."

  ---
  My instinct: A + B + C are the strongest, because they attack
  things the system structurally can't do and map to open SPL
  research problems — which matters if this is research-flavored
  Today harvest proposes lifting a customization, but if the lift needs real new platform code, a human writes it. This
  agent takes the proposal and actually authors the platform code, opens the MR, and iterates the derive→test loop until
  it's green — going from "here's a patch idea" to "here's a merged, working feature."

  ---
  My instinct: A + B + C are the strongest, because they attack things the system structurally can't do and map to open
  SPL research problems — which matters if this is research-flavored work.

  But I've now guessed wrong once, so rather than guess again: what's the actual goal behind "make development faster"? A
  few things would sharpen this a lot —

  - Is this research (novel contribution, maps to literature gaps) or practical (save your real users clicks/hours)?
  - Which hurts more today: starting an SPL (adoption), authoring the platform, testing the variant space, or
  communicating/onboarding?
  - And honestly — is there a use case you already had in mind that prompted this whole question? I'd rather build around
  that than keep pitching.
---

## Captured idea seeds (2026-06-24, from Untitled-1.md)

_Raw notes promoted here from a stray root file so they're not lost._

- **Agent vs. pipeline boundary.** It's often hard to tell whether a task warrants
  an LLM agent or a simple deterministic pipeline. Some parts are easier to delegate
  to an LLM at first, but over time, once an automation can be done deterministically,
  it's better to migrate those processes to deterministic code — gaining reliability
  and reducing the number of LLM agents.

- **Orchestration DSL.** A DSL to orchestrate agents and pipelines for each SPL or
  product — both textual and visual — with execution times, crons, conditionals, etc.
  Runs could fire automatically or be triggered manually, with everything recorded
  (logs, history) so processes can be improved over time.

- **Feature → file location store.** Persist where features live (which features map
  to which files) so that mapping can power further capabilities downstream.
