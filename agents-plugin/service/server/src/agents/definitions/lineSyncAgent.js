import { Container } from 'typedi';
import { registerAgent } from '../core/AgentRegistry.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';
import AgentRunRepository from '../models/AgentRunRepository.js';

const TERMINAL = ['done', 'failed', 'cancelled'];

/**
 * Line-wide "Sync": regenerate every product of a line against the latest
 * platform. The orchestrator fans out one `regen` child run per selected product
 * (the operator may deselect products at launch), then waits for them all.
 *
 * Conflicts are not resolved here — a conflicting regen auto-spawns the `sync`
 * resolver for that product (see regenAgent.js / domainSubscriber.js). This run
 * completing means "every selected product's regeneration was attempted"; the
 * resolvers surface separately on the Sync Console, correlated by line + product.
 *
 * The fan-out step uses the runner's spawnChild/awaitChild primitive: it spawns
 * on first entry, then on each child-termination re-entry re-checks its children
 * and re-waits until all are terminal. (Each re-entry appends a fresh `fan-out`
 * timeline tick — see AgentRunner's awaitChild handling.)
 */
const definition = {
  type: 'line-sync',
  title: 'Sync',
  description:
    'Regenerates every product of a line against the latest platform, fanning out a regeneration run per product and surfacing conflicts for resolution.',
  scope: 'line',

  steps: [
    {
      name: 'plan',
      kind: 'deterministic',
      run: async (ctx) => {
        if (!ctx.lineId) throw new Error('line-sync agent requires scope.lineId');

        const repo = Container.get(ProductRepository);
        const all = await repo.findByLineId(ctx.lineId);
        const live = all.filter((p) => !p.archived);

        // Operator selection (deselect in the launch dialog) wins; otherwise all
        // non-archived products. Intersect requested ids with what actually exists.
        const requested = Array.isArray(ctx.input?.productIds) ? ctx.input.productIds.map(String) : null;
        const liveIds = new Set(live.map((p) => String(p._id)));
        const productIds = (requested ? requested.filter((id) => liveIds.has(id)) : [...liveIds]);

        const names = Object.fromEntries(
          live.map((p) => [String(p._id), p.spec?.basicData?.name ?? String(p._id)])
        );

        return {
          output: {
            productIds,
            total: productIds.length,
            force: Boolean(ctx.input?.force),
            productNames: productIds.map((id) => names[id]).filter(Boolean),
          },
        };
      },
    },

    {
      name: 'fan-out',
      kind: 'deterministic',
      run: async (ctx) => {
        const plan = ctx.getStepOutput('plan') ?? {};
        const productIds = plan.productIds ?? [];
        const force = Boolean(plan.force);
        const repo = Container.get(AgentRunRepository);

        const summarize = (children) => {
          let clean = 0, conflicted = 0, failed = 0;
          // Keep the failed/conflicted product ids so the console can offer a focused
          // "Retry failed" (a thrown regen otherwise dead-ends — no event, no resolver).
          const failedProductIds = [];
          const conflictedProductIds = [];
          for (const c of children) {
            if (!c) continue;
            const pid = c.scope?.productId ? String(c.scope.productId) : null;
            if (c.status === 'failed' || c.status === 'cancelled') { failed += 1; if (pid) failedProductIds.push(pid); }
            else if (c.result?.conflicts) { conflicted += 1; if (pid) conflictedProductIds.push(pid); }
            else clean += 1;
          }
          return { clean, conflicted, failed, failedProductIds, conflictedProductIds };
        };

        // Children already exist → this is an awaitChild re-entry (woken by a child
        // reaching a terminal state). Re-check; keep waiting while any are in flight.
        const children = await repo.findByParentRunId(ctx.run._id);
        if (children.length > 0) {
          const pending = children.filter((c) => c && !TERMINAL.includes(c.status));
          if (pending.length > 0) {
            return { output: { total: productIds.length, pending: pending.length, done: false }, awaitChild: true };
          }
          const summary = summarize(children);
          return {
            output: { total: children.length, ...summary, done: true },
            result: { total: children.length, ...summary },
          };
        }

        // First entry. Nothing to do for an empty selection.
        if (productIds.length === 0) {
          return { output: { total: 0, clean: 0, conflicted: 0, failed: 0, done: true }, result: { total: 0 } };
        }

        // Fan out one regen child per product, then wait. The single in-process
        // runner queue drains them sequentially.
        const childRunIds = [];
        for (const productId of productIds) {
          const child = await ctx.spawnChild({
            agentType: 'regen',
            scope: { lineId: ctx.lineId, productId },
            input: { force },
          });
          childRunIds.push(String(child._id));
        }
        return { output: { total: childRunIds.length, childRunIds, pending: childRunIds.length, done: false }, awaitChild: true };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
