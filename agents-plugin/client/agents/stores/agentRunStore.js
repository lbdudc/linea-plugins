import { reactive, computed } from 'vue'

const _state = reactive({ runs: [] })

export const agentRunStore = {
  get runs() { return _state.runs },

  setAll(runs) {
    _state.runs = runs
  },

  upsert(run) {
    const idx = _state.runs.findIndex(r => r._id === run._id)
    if (idx >= 0) _state.runs[idx] = { ..._state.runs[idx], ...run }
    else _state.runs.unshift(run)
  },

  // Removes the run and every descendant transitively (not just direct
  // children) — a grandchild whose parent was just removed would otherwise be
  // left behind, still counted by active/awaiting-approval totals.
  remove(runId) {
    const toRemove = new Set([String(runId)])
    let grew = true
    while (grew) {
      grew = false
      for (const r of _state.runs) {
        const rid = String(r._id)
        if (!toRemove.has(rid) && toRemove.has(String(r.parentRunId))) {
          toRemove.add(rid)
          grew = true
        }
      }
    }
    _state.runs = _state.runs.filter(r => !toRemove.has(String(r._id)))
  },

  mergeStep(runId, status, step) {
    const idx = _state.runs.findIndex(r => r._id === runId)
    if (idx < 0) return
    const run = { ..._state.runs[idx], status: status ?? _state.runs[idx].status }
    const steps = [...(run.steps ?? [])]
    const sIdx = steps.findIndex(s => s._id === step._id)
    if (sIdx >= 0) steps[sIdx] = step
    else steps.push(step)
    run.steps = steps
    _state.runs[idx] = run
  },

  mergeProposal(runId, proposal) {
    const idx = _state.runs.findIndex(r => r._id === runId)
    if (idx < 0) return
    const run = { ..._state.runs[idx] }
    const proposals = [...(run.proposals ?? [])]
    const pIdx = proposals.findIndex(p => p._id === proposal._id)
    if (pIdx >= 0) proposals[pIdx] = proposal
    else proposals.push(proposal)
    run.proposals = proposals
    _state.runs[idx] = run
  },
}

export const awaitingApprovalCount = computed(() =>
  _state.runs.filter(r => r.status === 'awaiting_approval').length
)
