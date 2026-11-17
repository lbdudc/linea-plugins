import { Container } from 'typedi';
import AgentRunner from '../core/AgentRunner.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import { botUserId } from './actors.js';

/**
 * Reconciliation backstop for the Sync resolver. The resolver normally starts from
 * the in-process PRODUCT_GENERATED event (domainSubscriber.js). That event is lost
 * if the server restarts after the product's transaction commits but before the sync
 * run is created, or if enqueueNew throws — leaving a conflicted product with no
 * resolver and nothing to retry it.
 *
 * This sweep closes that hole: it finds products whose latest regen ended in a merge
 * conflict and have no sync run since, and enqueues one. Idempotent — a product with
 * any sync run (active or terminal) since its conflicting regen is skipped, so the
 * sweep never duplicates and never loops on a sync that keeps failing.
 *
 * Runs once on boot (after recovery) and, when SYNC_RECONCILE_INTERVAL_MS is set, on
 * that interval. Attribution: BOT_USER if it has logged in to agents, else the conflicting regen's creator.
 */
let timer = null;

export const runReconcileSweep = async () => {
  const repo = Container.get(AgentRunRepository);
  const runner = Container.get(AgentRunner);
  const botId = await botUserId();

  let conflicted;
  try {
    conflicted = await repo.findLatestConflictedRegens();
  } catch (err) {
    console.error('[agents] reconcile sweep query failed:', err?.message ?? err);
    return { enqueued: 0 };
  }

  let enqueued = 0;
  for (const regen of conflicted) {
    try {
      const productId = String(regen.scope.productId);
      const lineId = regen.scope?.lineId ? String(regen.scope.lineId) : null;

      // Already has a resolver (or one that ran) since the conflict → leave it alone.
      if (await repo.hasSyncRunSince(regen.scope.productId, regen.createdAt)) continue;

      const userId = botId ?? (regen.createdBy ? String(regen.createdBy) : null);
      if (!userId) {
        console.warn(`[agents] reconcile: product ${productId} has a conflicted regen but no creator and BOT_USER is unset — skipping`);
        continue;
      }

      await runner.enqueueNew({
        agentType: 'sync',
        scope: { productId, lineId },
        input: { stage: regen.result?.stage, version: regen.result?.version },
        trigger: { kind: 'reconcile' },
        userId,
      });
      enqueued++;
    } catch (err) {
      console.error('[agents] reconcile: failed to enqueue sync run:', err?.message ?? err);
    }
  }

  if (enqueued) console.log(`[agents] reconcile sweep enqueued ${enqueued} sync run(s)`);
  return { enqueued };
};

export const startReconcileSweep = () => {
  const intervalMs = Number(process.env.SYNC_RECONCILE_INTERVAL_MS);
  if (!intervalMs) {
    console.log('[agents] sync reconcile sweep disabled (set SYNC_RECONCILE_INTERVAL_MS to enable)');
    return;
  }
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    runReconcileSweep().catch((err) => console.error('[agents] reconcile sweep error:', err?.message ?? err));
  }, intervalMs);
  timer.unref?.();
  console.log(`[agents] sync reconcile sweep enabled: every ${intervalMs}ms`);
};
