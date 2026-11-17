import { Container } from 'typedi';
import AgentRunner from '../core/AgentRunner.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import { emitRun } from '../core/events.js';

/**
 * Merge & split for in-review harvest proposals.
 *
 * `merge` folds 2+ paused harvest runs into one new harvest run carrying
 * `input.merge = { sourceRunIds, directive }`. That run flows through the normal
 * pipeline, but its detect/classify/propose steps branch on `input.merge` so the
 * LLM re-synthesizes a single unified proposal from the sources + the operator's
 * free-text directive (see harvestAgent.js / proposeHarvest.js).
 *
 * The sources are parked at status 'superseded' (hidden from every kanban column)
 * and stamped with `supersededByRunId`. `split` reverses that while the merged run
 * is still in review (not yet MR-opened), restoring the originals untouched.
 */
export default class HarvestMergeService {
  runner = Container.get(AgentRunner);
  agentRunRepository = Container.get(AgentRunRepository);

  merge = async ({ lineId, runIds, directive, userId }) => {
    if (!Array.isArray(runIds) || runIds.length < 2) {
      throw new Error('Select at least two proposals to merge');
    }

    const runs = await Promise.all(runIds.map((id) => this.agentRunRepository.findById(id)));
    runs.forEach((run, i) => {
      if (!run) throw new Error(`Run not found: ${runIds[i]}`);
      if (run.agentType !== 'harvest') throw new Error('Only harvest proposals can be merged');
      if (run.status !== 'awaiting_approval') throw new Error('All proposals must be in review');
      if (String(run.scope?.lineId) !== String(lineId)) throw new Error('All proposals must belong to the same line');
      const pending = run.proposals?.find((p) => p.kind === 'fm_patch' && !p.decision);
      if (!pending) throw new Error('A selected run has no pending proposal to merge');
    });

    const firstProductId = runs[0].scope?.productId;
    if (!firstProductId) throw new Error('Source run is missing its product scope');

    // The merged run is an ordinary harvest run; the pipeline reads input.merge.
    const merged = await this.runner.enqueueNew({
      agentType: 'harvest',
      scope: { lineId, productId: firstProductId },
      input: { merge: { sourceRunIds: runIds.map(String), directive: directive ?? '' } },
      trigger: { kind: 'manual' },
      userId,
    });

    // Park the sources so they leave the In-review column but can be restored.
    // Independent docs — safe to save in parallel instead of one at a time.
    await Promise.all(runs.map(async (run) => {
      run.status = 'superseded';
      run.supersededByRunId = merged._id;
      await run.save();
      emitRun(run);
    }));

    return merged;
  };

  split = async ({ runId }) => {
    const merged = await this.agentRunRepository.findById(runId);
    if (!merged) throw new Error('Run not found');
    if (!merged.input?.merge) throw new Error('Not a merged run');
    if (merged.status === 'done') throw new Error('This merge already opened an MR and can no longer be split');

    const sourceRunIds = merged.input.merge.sourceRunIds ?? [];
    // Independent docs — fetch and save in parallel instead of one at a time.
    await Promise.all(sourceRunIds.map(async (id) => {
      const src = await this.agentRunRepository.findById(id);
      if (!src) return;
      src.status = 'awaiting_approval';
      src.supersededByRunId = undefined;
      await src.save();
      emitRun(src);
    }));

    merged.status = 'superseded';
    await merged.save();
    emitRun(merged);

    return { runId: String(merged._id), restored: sourceRunIds.map(String) };
  };
}

Container.set(HarvestMergeService, new HarvestMergeService());
