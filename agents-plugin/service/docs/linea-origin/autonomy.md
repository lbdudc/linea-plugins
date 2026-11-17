# Per-Product Autonomy

## Overview

Each agent run that proposes a write operation goes through the **ApprovalGate** before the runner either pauses for human review or proceeds automatically. The gate's decision is determined by three layered rules applied in order.

---

## ApprovalGate Decision Tree

```
proposal arrives at ApprovalGate.decide()
    │
    ├── Rule 1: Blast Radius
    │       proposal.blastRadius === 'line'?
    │           YES → require  (always — line changes affect every product)
    │           NO  ↓
    │
    ├── Rule 2: Criticality
    │       resolveEffective(lineId, productId).criticality === 'critical'?
    │           YES → require
    │           NO  ↓
    │
    ├── Rule 3: Mode + Ambiguity
    │       resolvedPolicy.modes[agentType] !== 'automatic'?
    │           YES → require
    │           NO  ↓
    │       proposal.unambiguous === true?
    │           YES → auto   ← the only path to fully automatic action
    │           NO  → require
    │
    └── Result: 'auto' | 'require'
```

**`auto`** — the runner records the proposal as `decision: 'auto'` and continues to the next step without pausing.

**`require`** — the run status changes to `awaiting_approval` and the Socket.IO `agent-proposal` event is emitted. The run is paused until a human calls `POST /api/agents/runs/:id/decide`.

---

## Blast Radius

Every proposal declares a `blastRadius`:

| Blast Radius | Meaning | Can ever be automatic? |
|-------------|---------|----------------------|
| `product` | Write affects only this product's repo | Yes, with correct policy |
| `line` | Write affects the line repo (impacts all products) | **Never** |

Agents with always-line-radius proposals:
- **Harvest** — `open-mr` commits to the line repo (fm_patch)
- **Evolution** — `apply-fixes` changes product specs (spec_patch, `blastRadius='product'`)

---

## Policy Model

Policies live in the `AgentPolicy` collection. There are two levels:

### Line-level default
`{ scope: { lineId, productId: null } }` — applies to all products in the line unless overridden.

### Product-level override
`{ scope: { lineId, productId } }` — overrides the line default for a specific product.

### Resolution order
```
product policy → line default → built-in defaults
```

Built-in defaults:
```js
{
  criticality: 'normal',
  modes: {
    sync:      'propose_and_wait',
    harvest:   'propose_and_wait',
    evolution: 'propose_and_wait',
  }
}
```

---

## Setting Policies

### Via UI
The **Autonomy** section in the ProductDetail "Configuration" tab shows a `ProductAutonomyToggle` component. It exposes:
- **Criticality toggle** — Normal / Critical
- **Sync mode select** — Propose & wait / Automatic (disabled when critical)

### Via API
```
GET  /api/agents/policy?lineId=<lineId>&productId=<productId>
     → resolved effective policy (product override merged with line default merged with built-ins)

PUT  /api/agents/policy
     Body: { lineId, productId?, criticality?, modes: { sync?, harvest?, evolution? } }
     → upserts product- or line-level policy
```

---

## `unambiguous` Flag

Even when mode is `automatic`, the gate requires the proposal to declare `unambiguous: true`. This is the deterministic safety core — Claude proposes, the SPL engine validates.

| Agent | When `unambiguous = true` |
|-------|--------------------------|
| Sync (git_comment) | ALL conflicting files are generator-owned (`'theirs'`) — no manual customizations at risk |
| Sync (merge_resolution) | **Never** — always `false`; rich diffs always need a human |
| Others | Not set (implicitly `false`) |

---

## Example Scenarios

| Product setting | Proposal kind | Conflict type | Decision |
|----------------|--------------|---------------|---------|
| criticality=normal, sync=automatic | git_comment | all generator-owned files | **auto** |
| criticality=normal, sync=automatic | git_comment | includes README.md | require |
| criticality=critical, sync=automatic | any | any | require |
| criticality=normal, sync=propose_and_wait | any | any | require |
| any | fm_patch (harvest) | any | require (line blast radius) |
| any | merge_resolution (sync) | any | require (unambiguous=false) |

---

## Proposal Versioning

For `merge_resolution` (Sync) and `fm_patch` (Harvest) proposals, each `/refine` call snapshots the current proposal body into `body.versions[]` before replacing it. This lets the user revert to a prior version:

```
POST /api/agents/runs/:id/restore-version
Body: { proposalId?, versionIndex }
```

The restore itself also pushes the "current" body as a new version before restoring, making the operation reversible — every version is always reachable.
