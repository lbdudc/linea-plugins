import { Container } from 'typedi';
import LineRepository from '../../model/repositories/LineRepository.js';
import AgentRunner from '../core/AgentRunner.js';
import AgentConfigRepository from '../models/AgentConfigRepository.js';
import { botUserId } from './actors.js';

/**
 * Periodic Line Health scheduler. Disabled unless HEALTH_INTERVAL_MS is set.
 * The runs are the service account's: BOT_USER, a git username that has logged in to agents. It also decides which lines
 * there are: the ones it is a member of in LINEA.
 *
 * Example: HEALTH_INTERVAL_MS=604800000 (weekly), BOT_USER=agents-bot
 */
let timer = null;

export const startScheduler = () => {
  const intervalMs = Number(process.env.HEALTH_INTERVAL_MS);

  if (!intervalMs) {
    console.log('[agents] scheduler disabled (set HEALTH_INTERVAL_MS to enable)');
    return;
  }

  if (!process.env.BOT_USER) {
    console.warn('[agents] scheduler disabled: BOT_USER is not set (it is who the scheduled runs act as)');
    return;
  }

  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    try {
      const userId = await botUserId();
      if (!userId) return;
      const lines = await Container.get(LineRepository).getAll({ userId });
      let enqueued = 0;
      for (const line of lines) {
        // Skip lines where line-health has been detached in the Customization tab.
        const cfg = await Container.get(AgentConfigRepository).resolveEffective({
          lineId: String(line._id),
          agentType: 'line-health',
        });
        if (cfg.enabled === false) continue;
        await Container.get(AgentRunner).enqueueNew({
          agentType: 'line-health',
          scope: { lineId: String(line._id) },
          trigger: { kind: 'scheduled' },
          userId,
        });
        enqueued++;
      }
      console.log(`[agents] scheduler enqueued line-health for ${enqueued}/${lines.length} line(s)`);
    } catch (err) {
      console.error('[agents] scheduler error:', err?.message ?? err);
    }
  }, intervalMs);
  timer.unref?.();

  console.log(`[agents] scheduler enabled: line-health every ${intervalMs}ms (BOT_USER=${process.env.BOT_USER})`);
};
