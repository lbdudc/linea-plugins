import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Line-sync orchestration fan-out — exercised against the agent definition's
 * `plan` and `fan-out` step `run` functions with mocked repositories and a fake
 * `ctx`, so no database or runner is required. Covers the three states the
 * awaitChild loop can be in: first entry (spawn + wait), re-entry with children
 * still in flight (keep waiting), and re-entry with all children terminal
 * (summarize clean / conflicted / failed).
 */

// Controlled fixtures, mutated per test.
const products = [
  { _id: 'p1', archived: false, spec: { basicData: { name: 'A' } } },
  { _id: 'p2', archived: false, spec: { basicData: { name: 'B' } } },
  { _id: 'p3', archived: true, spec: { basicData: { name: 'archived' } } },
];
let children = [];

vi.mock('typedi', () => {
  const store = new Map();
  return {
    Container: {
      get: (key) => store.get(key),
      set: (key, val) => store.set(key, val),
    },
  };
});

vi.mock('../../model/repositories/ProductRepository.js', () => {
  class ProductRepository {
    async findByLineId() { return products; }
  }
  return { default: ProductRepository };
});

vi.mock('../../agents/models/AgentRunRepository.js', () => {
  class AgentRunRepository {
    async findByParentRunId() { return children; }
  }
  return { default: AgentRunRepository };
});

const { Container } = await import('typedi');
const ProductRepository = (await import('../../model/repositories/ProductRepository.js')).default;
const AgentRunRepository = (await import('../../agents/models/AgentRunRepository.js')).default;
const definition = (await import('../../agents/definitions/lineSyncAgent.js')).default;

Container.set(ProductRepository, new ProductRepository());
Container.set(AgentRunRepository, new AgentRunRepository());

const stepByName = (name) => definition.steps.find((s) => s.name === name);

const makeCtx = ({ planOutput, spawned, input = {} } = {}) => ({
  lineId: 'L',
  input,
  run: { _id: 'parent' },
  getStepOutput: (n) => (n === 'plan' ? planOutput : null),
  spawnChild: vi.fn(async ({ scope }) => {
    const child = { _id: `child-${scope.productId}` };
    spawned?.push(child);
    return child;
  }),
});

beforeEach(() => { children = []; });

describe('line-sync agent', () => {
  it('plan selects all non-archived products (and honours an operator subset)', async () => {
    const all = await stepByName('plan').run(makeCtx());
    expect(all.output.productIds.sort()).toEqual(['p1', 'p2']);
    expect(all.output.total).toBe(2);

    const subset = await stepByName('plan').run(makeCtx({ input: { productIds: ['p2', 'pX'] } }));
    expect(subset.output.productIds).toEqual(['p2']); // pX does not exist; p3 archived excluded
  });

  it('fan-out spawns one regen child per product on first entry, then awaits', async () => {
    const spawned = [];
    const ctx = makeCtx({ planOutput: { productIds: ['p1', 'p2'], force: false }, spawned });
    const out = await stepByName('fan-out').run(ctx);

    expect(ctx.spawnChild).toHaveBeenCalledTimes(2);
    expect(ctx.spawnChild).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'regen', scope: { lineId: 'L', productId: 'p1' } })
    );
    expect(out.awaitChild).toBe(true);
    expect(out.output.childRunIds).toHaveLength(2);
    expect(out.result).toBeUndefined();
  });

  it('fan-out keeps waiting while any child is still in flight', async () => {
    children = [
      { status: 'running' },
      { status: 'done', result: { conflicts: false } },
    ];
    const ctx = makeCtx({ planOutput: { productIds: ['p1', 'p2'] } });
    const out = await stepByName('fan-out').run(ctx);

    expect(ctx.spawnChild).not.toHaveBeenCalled();
    expect(out.awaitChild).toBe(true);
    expect(out.output.done).toBe(false);
  });

  it('fan-out summarizes clean / conflicted / failed once all children are terminal', async () => {
    children = [
      { status: 'done', result: { conflicts: false }, scope: { productId: 'p1' } },
      { status: 'failed', scope: { productId: 'p2' } },
      { status: 'done', result: { conflicts: true }, scope: { productId: 'p3' } },
    ];
    const ctx = makeCtx({ planOutput: { productIds: ['p1', 'p2', 'p3'] } });
    const out = await stepByName('fan-out').run(ctx);

    expect(out.awaitChild).toBeUndefined();
    // Counts plus the per-product id lists that power the console's "Retry failed".
    expect(out.result).toEqual({
      total: 3, clean: 1, conflicted: 1, failed: 1,
      failedProductIds: ['p2'], conflictedProductIds: ['p3'],
    });
  });

  it('fan-out finishes immediately for an empty selection', async () => {
    const ctx = makeCtx({ planOutput: { productIds: [] } });
    const out = await stepByName('fan-out').run(ctx);
    expect(ctx.spawnChild).not.toHaveBeenCalled();
    expect(out.awaitChild).toBeUndefined();
    expect(out.result.total).toBe(0);
  });
});
