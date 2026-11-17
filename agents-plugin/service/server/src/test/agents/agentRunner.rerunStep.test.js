import { describe, it, expect, vi } from 'vitest';

/**
 * rerunStep's proposal-drop filter — exercised against the real AgentRunner
 * with every dependency mocked (no DB, no queue advance), following the
 * pattern in reconcileSync.test.js. Covers the bug where the filter compared
 * a step name against a kebab-cased `body.phase` string that real agent step
 * names never match, so the filter was a silent no-op: rerunning a step never
 * dropped the stale (already-decided) proposal it had produced before.
 */

vi.mock('typedi', () => {
  const store = new Map();
  return { Container: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) } };
});

vi.mock('../../agents/models/AgentRunRepository.js', () => {
  class AgentRunRepository {}
  return { default: AgentRunRepository };
});
vi.mock('../../agents/core/ApprovalGate.js', () => {
  class ApprovalGate {}
  return { default: ApprovalGate };
});
vi.mock('../../agents/memory/MemoryService.js', () => {
  class MemoryService {}
  return { default: MemoryService };
});
vi.mock('../../agents/models/AgentConfigRepository.js', () => {
  class AgentConfigRepository {}
  return { default: AgentConfigRepository };
});
vi.mock('../../agents/core/events.js', () => ({
  emitRun: vi.fn(),
  emitStep: vi.fn(),
  emitProposal: vi.fn(),
}));
// Real createRunQueue would try to advance the run in the background after
// rerunStep enqueues it, pulling in the real agent step machinery — stub it
// so this test stays scoped to rerunStep's own proposal-filtering logic.
vi.mock('../../agents/core/runQueue.js', () => ({
  createRunQueue: () => ({ enqueue: vi.fn() }),
}));

const AgentRunner = (await import('../../agents/core/AgentRunner.js')).default;

// A run mid-way through changesetAgent: 'approve-plan' produced and got an
// APPROVED plan_approval proposal (phase "Phase 2 · Plan approval"), then a
// later step failed. Rerunning 'approve-plan' should force a fresh decision.
const buildRun = () => ({
  _id: 'run-1',
  status: 'failed',
  cursor: 3,
  error: 'merge-branch blew up',
  steps: [
    { name: 'plan', status: 'done' },
    { name: 'approve-plan', status: 'done' },
    { name: 'sandbox', status: 'skipped' },
    { name: 'merge-branch', status: 'failed' },
  ],
  proposals: [
    {
      kind: 'plan_approval',
      decision: 'approved',
      stepName: 'approve-plan',
      body: { phase: 'Phase 2 · Plan approval' },
    },
  ],
  markModified: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
});

describe('AgentRunner.rerunStep', () => {
  it('drops the stale proposal via the stepName tag (current format)', async () => {
    const run = buildRun();
    const repo = { findById: vi.fn().mockResolvedValue(run) };
    const runner = new AgentRunner();
    runner.agentRunRepository = repo;

    const result = await runner.rerunStep('run-1', 'approve-plan');

    expect(result.proposals).toHaveLength(0);
    expect(result.steps).toHaveLength(1); // only 'plan' survives the rewind
    expect(result.status).toBe('queued');
    expect(result.cursor).toBe(1);
  });

  it('falls back to matching the phase string for a pre-migration proposal, when it slugifies to the step name', async () => {
    // Only proposals saved before this fix shipped lack `stepName`; the fallback
    // covers them for the (narrower) case where the phase text happens to
    // slugify to the step name — it can't retroactively fix a mismatched pair
    // like 'approve-plan' / "Plan approval" (see the no-op regression test below).
    const run = buildRun();
    run.proposals[0].body.phase = 'Phase 2 · Approve plan';
    delete run.proposals[0].stepName; // simulate a pre-migration proposal
    const repo = { findById: vi.fn().mockResolvedValue(run) };
    const runner = new AgentRunner();
    runner.agentRunRepository = repo;

    const result = await runner.rerunStep('run-1', 'approve-plan');

    expect(result.proposals).toHaveLength(0);
  });

  it('regression: a pre-migration proposal whose phase text does not slugify to the step name is NOT dropped by the fallback', async () => {
    // Documents the residual gap: proposals created before this fix (no stepName)
    // on a run whose step/phase naming doesn't happen to align are still not
    // dropped by rerunStep. This is the original bug, now scoped to old data only
    // — every proposal created after this fix carries stepName and is unaffected.
    const run = buildRun();
    delete run.proposals[0].stepName;
    const repo = { findById: vi.fn().mockResolvedValue(run) };
    const runner = new AgentRunner();
    runner.agentRunRepository = repo;

    const result = await runner.rerunStep('run-1', 'approve-plan');

    expect(result.proposals).toHaveLength(1);
  });

  it('keeps a decided proposal from an earlier step untouched', async () => {
    const run = buildRun();
    run.proposals[0].stepName = 'plan'; // decided by an earlier step, not the rewind target
    const repo = { findById: vi.fn().mockResolvedValue(run) };
    const runner = new AgentRunner();
    runner.agentRunRepository = repo;

    const result = await runner.rerunStep('run-1', 'approve-plan');

    expect(result.proposals).toHaveLength(1);
  });
});
