import { runAs } from '../../linea/actingUser.js';
import { linea } from '../../linea/LineaClient.js';
import { ensurePushHook } from '../../linea/repo.js';
import { botUserId } from './actors.js';

/**
 * Agents hears about direct pushes to a product's `main` as `git:pushed` events from LINEA (pushSubscriber.js). The local git host
 * reports its pushes itself; for the others LINEA needs a push hook on each repository, which it asks the host for when agents asks
 * LINEA (`POST /api/repos/:id/push-hook`, as BOT_USER, which has to be a maintainer of the products). LINEA knows which host and how.
 *
 * Idempotent: a repository that has the hook is left alone.
 */
export const ensureProductPushHooks = async () => {
  const userId = await botUserId();
  if (!userId) return { created: 0, failed: 0, skipped: true };

  const products = await runAs(userId, () => linea.get('/api/products/enrolled'));
  const result = { created: 0, failed: 0, skipped: false, unavailable: false };

  for (const product of products) {
    const id = product.repo?.id;
    if (!id) continue;
    try {
      const outcome = await runAs(userId, () => ensurePushHook({ id, host: product.gitHost }));
      if (outcome?.status === 'created') result.created++;
      if (outcome?.status === 'unavailable') { result.unavailable = true; break; }
    } catch (error) {
      result.failed++;
      console.warn(`[agents] push hook for product ${product._id} (repository ${id}) not registered: ${error?.message ?? error}`);
    }
  }
  if (result.unavailable) console.log('[agents] push hooks not registered: LINEA has no public address or webhook secret (PUBLIC_URL, GIT_WEBHOOK_SECRET)');
  else if (result.created || result.failed) console.log(`[agents] push hooks: ${result.created} created, ${result.failed} failed`);
  return result;
};

let timer = null;

/** Registers now and then every PUSH_HOOK_SYNC_INTERVAL_MS (default 6 h; 0 turns the periodic part off). */
export const startPushHookSync = () => {
  // LINEA may not be up yet when agents starts: a failed first try is tried again soon (up to 5 times), not in 6 hours
  const first = (attempt = 1) => ensureProductPushHooks()
    .then((result) => { if (result.failed && attempt < 5) setTimeout(() => first(attempt + 1), 30_000 * attempt).unref?.(); })
    .catch((error) => {
      console.error('[agents] push hook registration failed:', error?.message ?? error);
      if (attempt < 5) setTimeout(() => first(attempt + 1), 30_000 * attempt).unref?.();
    });
  first();
  const intervalMs = Number(process.env.PUSH_HOOK_SYNC_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
  if (!intervalMs) return;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    ensureProductPushHooks().catch((error) => console.error('[agents] push hook registration failed:', error?.message ?? error));
  }, intervalMs);
  timer.unref?.();
};
