import { Container } from 'typedi';
import { productAccess } from '../tools/git.js';
import { runSyncResolution, buildResolutionMarkdown, planToToolInput } from './proposeSync.js';
import { validateProductFm } from './syncValidation.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import { emitProposal, emitRun, emitStep } from '../core/events.js';
import { withRecordedVersion } from '../core/proposalVersions.js';
import PlaygroundService from '../playground/PlaygroundService.js';
import { properties } from '../../model/connectors/properties.js';

/**
 * Interactive refinement of a paused Sync auto-resolve proposal. The user chats
 * feedback; the agent re-runs the resolution tool loop seeded with the current
 * proposal + that feedback, and replaces the pending proposal in place (the run
 * stays paused at awaiting_approval until accepted). Mirrors HarvestService.
 */
export default class SyncResolveService {
  agentRunRepository = Container.get(AgentRunRepository);
  playgroundService = Container.get(PlaygroundService);

  refine = async ({ runId, userId, message }) => {
    if (!message || !message.trim()) throw new Error('Empty feedback message');

    const run = await this.agentRunRepository.findById(runId);
    if (!run) throw new Error('Run not found');
    if (run.agentType !== 'sync') throw new Error('Not a sync run');
    if (run.status !== 'awaiting_approval') throw new Error('Run is not awaiting approval');

    const proposal = run.proposals.find((p) => p.kind === 'merge_resolution' && !p.decision);
    if (!proposal) throw new Error('No pending resolution to refine');

    const priorPlan = proposal.body?.plan;
    if (!priorPlan) throw new Error('Missing prior resolution plan');

    // Reconstruct the resolution context from the prior steps.
    const stepOut = (name) => [...run.steps].reverse().find((s) => s.name === name && s.status === 'done')?.outputSummary;
    const ctxStep = stepOut('load-context');
    const diagnose = stepOut('diagnose');
    const conflict = stepOut('fetch-conflict-details');
    if (!conflict?.files) throw new Error('Missing conflict context for this run');

    const detect = {
      productName: ctxStep?.productName ?? 'product',
      features: ctxStep?.features ?? [],
      diagnosis: diagnose?.diagnosis ?? null,
      files: conflict.files,
    };

    const productId = run.scope?.productId ? String(run.scope.productId) : null;
    const { projectId } = await productAccess({ productId, userId });

    // Record the feedback as a refine step (shows in the timeline; doubles as chat log).
    run.steps.push({ name: 'refine', kind: 'llm', status: 'running', startedAt: new Date(), inputSummary: message });
    const refineStep = run.steps[run.steps.length - 1];
    await run.save();
    emitStep(run, refineStep);

    const newPlan = await runSyncResolution({
      projectId,
      detect,
      fileResolution: conflict.resolution ?? [],
      prior: { input: priorPlan, feedback: message },
    });

    if (!newPlan || !(newPlan.resolveEdits ?? []).length) {
      refineStep.status = 'done';
      refineStep.endedAt = new Date();
      refineStep.outputSummary = { revised: false, note: newPlan?.summary ?? 'No revision produced.' };
      run.markModified('steps');
      await run.save();
      emitStep(run, refineStep);
      return { proposal, revised: false };
    }

    const markdown = buildResolutionMarkdown({ plan: newPlan, recheck: null });
    const fm = await validateProductFm({ productId, userId });

    // Snapshot the version being replaced so the engineer can revert to it.
    const versions = withRecordedVersion(proposal.body, `${(proposal.body?.fileEdits ?? []).length} file(s)`);

    proposal.body = {
      ...proposal.body,
      title: proposal.body?.title ?? 'Resolve bigbang → main conflict',
      markdown,
      fileEdits: (newPlan.resolveEdits ?? []).map((e) => ({
        path: e.path,
        action: e.action ?? 'update',
        newContent: e.newContent ?? '',
        oldContent: e.oldContent ?? '',
        rationale: e.rationale ?? '',
        confidence: e.confidence ?? 'ai',
      })),
      plan: planToToolInput(newPlan),
      validation: { fm },
      versions,
      // The prior proposal's test result described different fileEdits — it must
      // not survive onto these, whether or not the re-test below produces a fresh one.
      testResult: null,
    };

    // Re-run the product test suite against the refined edits (silent, no WS events).
    const sourceBranch = conflict.mr?.sourceBranch ?? properties.git?.baseBranch ?? 'bigbang';
    let testResult = null;
    try {
      testResult = await this.playgroundService.testFileEdits({
        userId,
        productId,
        branch: sourceBranch,
        fileEdits: proposal.body.fileEdits,
      });
    } catch { /* best-effort — never block the refine on a test infra failure */ }

    if (testResult && !testResult.noTestCommand) {
      proposal.body.testResult = {
        passed: testResult.passed,
        exitCode: testResult.exitCode,
        log: (testResult.log ?? '').slice(-3000),
      };
    }

    refineStep.status = 'done';
    refineStep.endedAt = new Date();
    refineStep.durationMs = refineStep.startedAt ? refineStep.endedAt - refineStep.startedAt : null;
    refineStep.outputSummary = {
      revised: true,
      files: (newPlan.resolveEdits ?? []).length,
      testPassed: testResult?.passed ?? null,
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

Container.set(SyncResolveService, new SyncResolveService());
