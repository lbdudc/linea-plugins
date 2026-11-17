import { Container } from 'typedi';
import domainEvents, { DOMAIN_EVENTS } from '../../model/events/domainEvents.js';
import AgentRunner from '../core/AgentRunner.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import WebhookDeliveryRepository from '../models/WebhookDeliveryRepository.js';
import AgentConfigRepository from '../models/AgentConfigRepository.js';
import { runAs } from '../../linea/actingUser.js';
import { botUserId, userIdByUsername } from './actors.js';
import { findProductByRepoId, detectProductChanges } from '../tools/harvest.js';
import { branches } from '../tools/git.js';

let wired = false;

const deliveryRepo = () => Container.get(WebhookDeliveryRepository);

async function logDelivery(data) {
  try {
    await deliveryRepo().log(data);
  } catch {
    // best-effort
  }
}

/**
 * A push to a repository, as LINEA tells it (`git:pushed`, from any host: LINEA registers the host's hooks, or hears the local host
 * itself, and forwards the event signed to `/api/events`).
 *
 * A direct push to a product's `main` (a customization made outside the generation flow) enqueues a Harvest run for that product.
 * Harvest lifts the change UP into the line's platform as a new optional feature (or extends an existing one), so every sibling
 * product can then opt in to it via its spec. The run pauses at `awaiting_approval` — the line MR lands in "In review".
 *
 * The run is attributed to the person who pushed when they have signed in to agents, else to the service account (BOT_USER). Whoever
 * it is, LINEA is asked as them: a product they cannot see is, to them, a product that is not tracked.
 */
export const handlePush = async (payload) => {
  const projectId = payload?.repositoryId ?? null;
  const branch = payload?.branch ?? null;
  const username = payload?.username ?? payload?.actor?.username ?? null;
  const baseLog = { event: 'push', projectId, branch, username };

  try {
    // (a push that does not say which branch is looked at below: what `main` has beyond the baseline decides)
    if (branch && branch !== branches.default) {
      await logDelivery({ ...baseLog, status: 'ignored', detail: `branch ${branch} is not default` });
      return { status: 'ignored' };
    }

    // Whoever may look the product up: the person who pushed first, then the bot.
    const candidates = [...new Set([await userIdByUsername(username), await botUserId()].filter(Boolean))];
    if (candidates.length === 0) {
      console.warn(`[agents] push: "${username}" has not signed in to agents and BOT_USER is unset; skipping harvest`);
      await logDelivery({ ...baseLog, status: 'no_user', detail: `"${username}" unknown` });
      return { status: 'no_user' };
    }

    let product = null;
    let userId = null;
    for (const candidate of candidates) {
      product = projectId ? await runAs(candidate, () => findProductByRepoId(projectId, { host: payload?.host })) : null;
      if (product) { userId = candidate; break; }
    }
    if (!product) {
      await logDelivery({ ...baseLog, status: 'ignored', detail: 'no tracked product for the repository' });
      return { status: 'ignored' };
    }

    const enriched = { ...baseLog, productId: product._id, lineId: product.lineId };

    // Only what the product has beyond its generated baseline is a customization to lift (LINEA's own `.linea/**` is not one).
    const changes = await runAs(userId, () => detectProductChanges({ userId, projectId: product.repo.id }));
    if (changes.files.length === 0) {
      await logDelivery({ ...enriched, status: 'ignored', detail: 'nothing beyond the generated baseline' });
      return { status: 'ignored' };
    }

    // Respect per-scope customization: skip if Harvest is detached or its webhook trigger is turned off for this product/line.
    const harvestCfg = await Container.get(AgentConfigRepository).resolveEffective({
      lineId: String(product.lineId),
      productId: String(product._id),
      agentType: 'harvest',
    });
    if (harvestCfg.enabled === false || harvestCfg.triggers?.webhook === false) {
      await logDelivery({ ...enriched, status: 'disabled', detail: 'harvest disabled or push trigger off for scope' });
      return { status: 'disabled' };
    }

    const productId = String(product._id);
    const alreadyActive = await Container.get(AgentRunRepository).hasActiveRun({
      agentType: 'harvest',
      scopeField: 'productId',
      scopeValue: productId,
    });
    if (alreadyActive) {
      console.log(`[agents] push: harvest already active for product ${productId}, skipping`);
      await logDelivery({ ...enriched, status: 'already_active' });
      return { status: 'already_active' };
    }

    const run = await Container.get(AgentRunner).enqueueNew({
      agentType: 'harvest',
      scope: { productId, lineId: String(product.lineId) },
      trigger: { kind: 'git_push', payload: { event: 'push', branch: branch ?? branches.default, projectId } },
      userId,
    });

    await logDelivery({ ...enriched, status: 'enqueued', runId: run._id });
    return { status: 'harvest_enqueued' };
  } catch (err) {
    console.error('[agents] push error:', err?.message ?? err);
    await logDelivery({ ...baseLog, status: 'error', detail: err?.message ?? String(err) });
    return { status: 'error' };
  }
};

/** Subscribes to the pushes LINEA reports. Idempotent. */
export const wirePushSubscriber = () => {
  if (wired) return;
  wired = true;
  domainEvents.on(DOMAIN_EVENTS.GIT_PUSHED, (payload) => { handlePush(payload); });
};
