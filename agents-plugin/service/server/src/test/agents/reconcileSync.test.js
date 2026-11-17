import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sync reconciliation sweep — the durability backstop from Workstream 1A. Exercised
 * against `runReconcileSweep` with mocked typedi, repository and runner, so no DB is
 * required. Covers: enqueue one resolver for a conflicted product with no resolver,
 * skip when a sync run already exists since the conflict (no duplicate / no loop), and
 * skip when there is no user to attribute the run to.
 */

let conflicted = [];
let syncSince = false;
const enqueued = [];

vi.mock('typedi', () => {
  const store = new Map();
  return { Container: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) } };
});

// BOT_USER is a git username; this stands for the agents user it resolves to (that has logged in to agents)
vi.mock('../../agents/triggers/actors.js', () => ({
  botUserId: async () => (process.env.BOT_USER ? `id-of-${process.env.BOT_USER}` : null),
}));

vi.mock('../../agents/models/AgentRunRepository.js', () => {
  class AgentRunRepository {
    async findLatestConflictedRegens() { return conflicted; }
    async hasSyncRunSince() { return syncSince; }
  }
  return { default: AgentRunRepository };
});

vi.mock('../../agents/core/AgentRunner.js', () => {
  class AgentRunner {
    async enqueueNew(args) { enqueued.push(args); return { _id: 'sync-run' }; }
  }
  return { default: AgentRunner };
});

const { Container } = await import('typedi');
const AgentRunRepository = (await import('../../agents/models/AgentRunRepository.js')).default;
const AgentRunner = (await import('../../agents/core/AgentRunner.js')).default;
const { runReconcileSweep } = await import('../../agents/triggers/reconcileSync.js');

Container.set(AgentRunRepository, new AgentRunRepository());
Container.set(AgentRunner, new AgentRunner());

const regen = (over = {}) => ({
  scope: { productId: 'p1', lineId: 'L1' },
  result: { conflicts: true, stage: 'update', version: '2' },
  createdBy: 'u1',
  createdAt: new Date('2026-06-01'),
  ...over,
});

beforeEach(() => {
  conflicted = [];
  syncSince = false;
  enqueued.length = 0;
  delete process.env.BOT_USER;
});

describe('runReconcileSweep', () => {
  it('enqueues a sync resolver for a conflicted product with no resolver', async () => {
    conflicted = [regen()];
    const { enqueued: n } = await runReconcileSweep();

    expect(n).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      agentType: 'sync',
      scope: { productId: 'p1', lineId: 'L1' },
      input: { stage: 'update', version: '2' },
      trigger: { kind: 'reconcile' },
      userId: 'u1',
    });
  });

  it('skips a product that already has a sync run since the conflict (no duplicate / no loop)', async () => {
    conflicted = [regen()];
    syncSince = true;
    const { enqueued: n } = await runReconcileSweep();
    expect(n).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it('attributes to BOT_USER when set, over the regen creator', async () => {
    process.env.BOT_USER = 'bot';
    conflicted = [regen()];
    await runReconcileSweep();
    expect(enqueued[0].userId).toBe('id-of-bot');
  });

  it('skips when there is no creator and no BOT_USER', async () => {
    conflicted = [regen({ createdBy: null })];
    const { enqueued: n } = await runReconcileSweep();
    expect(n).toBe(0);
  });
});
