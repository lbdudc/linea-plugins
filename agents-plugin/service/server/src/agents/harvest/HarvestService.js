import { Container } from 'typedi';
import { productAccess } from '../tools/git.js';
import { validateModelAgainstProducts, classifyChangeSignals } from '../tools/harvest.js';
import { normalizeHarvestFmResult } from '../sync/syncValidation.js';
import { runHarvestProposal, buildProposalMarkdown, planToToolInput } from './proposeHarvest.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import LineService from '../../model/services/LineService.js';
import { emitProposal, emitRun, emitStep } from '../core/events.js';
import { withRecordedVersion } from '../core/proposalVersions.js';

/**
 * Interactive refinement of a paused Harvest proposal. The user chats feedback;
 * the agent re-runs the proposal tool loop seeded with the current proposal +
 * that feedback, re-validates the feature-model change, and replaces the pending
 * proposal in place (the run stays paused at awaiting_approval until accepted).
 */
export default class HarvestService {
  agentRunRepository = Container.get(AgentRunRepository);

  refine = async ({ runId, userId, message }) => {
    if (!message || !message.trim()) throw new Error('Empty feedback message');

    const run = await this.agentRunRepository.findById(runId);
    if (!run) throw new Error('Run not found');
    if (run.agentType !== 'harvest') throw new Error('Not a harvest run');
    if (run.status !== 'awaiting_approval') throw new Error('Run is not awaiting approval');

    const proposal = run.proposals.find((p) => p.kind === 'fm_patch' && !p.decision);
    if (!proposal) throw new Error('No pending proposal to refine');

    const detectStep = [...run.steps].reverse().find((s) => s.name === 'detect-changes' && s.status === 'done');
    const detect = detectStep?.outputSummary;
    if (!detect) throw new Error('Missing detect context for this run');

    const priorPlan = proposal.body?.plan;
    if (!priorPlan) throw new Error('Missing prior plan');

    const productId = run.scope?.productId ? String(run.scope.productId) : null;
    const { line } = await productAccess({ productId, userId });
    const lineProjectId = line.repoId;

    // Record the feedback as a refine step (shows in the timeline; doubles as chat log).
    run.steps.push({ name: 'refine', kind: 'llm', status: 'running', startedAt: new Date(), inputSummary: message });
    const refineStep = run.steps[run.steps.length - 1];
    await run.save();
    emitStep(run, refineStep);

    const signals = classifyChangeSignals({ files: detect.files ?? [], commits: detect.commits ?? [] });
    const newPlan = await runHarvestProposal({
      lineProjectId,
      detect,
      signals,
      prior: { input: priorPlan, feedback: message },
    });

    if (!newPlan || !newPlan.harvestable) {
      refineStep.status = 'done';
      refineStep.endedAt = new Date();
      refineStep.outputSummary = { revised: false, note: newPlan?.reasoning ?? 'No revision produced.' };
      run.markModified('steps');
      await run.save();
      emitStep(run, refineStep);
      return { proposal, revised: false };
    }

    let validation = { validated: false };
    if (newPlan.newModelUvl && detect.model?.type === 'UVL') {
      const products = await Container.get(LineService).findProductsByLineId({
        id: String(line._id), userId, specFromRepo: true,
      });
      try {
        const { valid, broken } = validateModelAgainstProducts({
          modelContent: newPlan.newModelUvl,
          type: 'UVL',
          products,
        });
        validation = { validated: true, valid, broken, checked: products.length };
      } catch (err) {
        validation = { validated: true, valid: false, broken: [], parseError: err?.message ?? String(err) };
      }
    }

    const fmUsable = Boolean(newPlan.newModelUvl) && detect.model?.type === 'UVL';
    const markdown = buildProposalMarkdown({ plan: newPlan, validation, model: detect.model });

    // Snapshot the version being replaced so the engineer can revert to it.
    const versions = withRecordedVersion(proposal.body, proposal.body?.featureName || 'previous');

    const changeType = newPlan.changeType ?? 'ambiguous';
    const title =
      changeType === 'bugfix-to-generated'
        ? 'Harvest: propagate fix to the platform'
        : changeType === 'extend-existing-feature'
        ? `Harvest: extend feature ${newPlan.featureName ?? '(change)'}`
        : `Harvest: add optional feature ${newPlan.featureName ?? '(change)'}`;

    proposal.body = {
      title,
      changeType,
      featureName: newPlan.featureName ?? null,
      markdown,
      modelPath: detect.model?.path ?? null,
      fmOld: detect.model?.content ?? '',
      newModelUvl: fmUsable ? newPlan.newModelUvl : null,
      fileEdits: newPlan.fileEdits ?? [],
      plan: planToToolInput(newPlan),
      validation: fmUsable ? { fm: normalizeHarvestFmResult(validation) } : null,
      versions,
    };

    refineStep.status = 'done';
    refineStep.endedAt = new Date();
    refineStep.outputSummary = {
      revised: true,
      feature: newPlan.featureName,
      files: (newPlan.fileEdits ?? []).length,
    };
    run.markModified('proposals');
    run.markModified('steps');
    await run.save();

    emitStep(run, refineStep);
    emitProposal(run, proposal);
    emitRun(run);

    return { proposal, revised: true };
  };
}

Container.set(HarvestService, new HarvestService());
