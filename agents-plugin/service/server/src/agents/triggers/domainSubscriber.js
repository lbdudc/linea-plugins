import { Container } from 'typedi';
import domainEvents, { DOMAIN_EVENTS } from '../../model/events/domainEvents.js';
import AgentRunner from '../core/AgentRunner.js';
import { botUserId, userIdByUsername } from './actors.js';

let wired = false;

/**
 * Subscribe the agents to model-layer domain events. Called once from
 * initAgents. Idempotent.
 *
 * Today: a conflicted `generateProduct` (LINEA tells us, see index.js `/api/events`) auto-enqueues a Sync run for that
 * product, as the person who generated it (`payload.actor`) or, failing that, the bot. Successful generations are ignored for now (a Release-Notes agent in
 * Phase 4 will consume those).
 */
export const wireDomainSubscribers = () => {
  if (wired) return;
  wired = true;

  domainEvents.on(DOMAIN_EVENTS.PRODUCT_GENERATED, async (payload) => {
    try {
      if (!payload?.conflicts) return;
      const userId = (await userIdByUsername(payload.actor?.username)) ?? (await botUserId());
      if (!userId) {
        console.warn(`[agents] conflict on product ${payload.productId}: ${payload.actor?.username ?? 'nobody'} has not logged in to agents and BOT_USER is unset — no sync run`);
        return;
      }
      await Container.get(AgentRunner).enqueueNew({
        agentType: 'sync',
        scope: { productId: payload.productId, lineId: payload.lineId },
        input: { stage: payload.stage, version: payload.version },
        trigger: { kind: 'git_event', payload: { event: DOMAIN_EVENTS.PRODUCT_GENERATED } },
        userId,
      });
      console.log(`[agents] auto-enqueued sync run for product ${payload.productId} (stage: ${payload.stage})`);
    } catch (err) {
      console.error('[agents] failed to enqueue sync run:', err?.message ?? err);
    }
  });
};
