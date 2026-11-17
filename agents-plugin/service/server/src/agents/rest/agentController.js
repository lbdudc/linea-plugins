import { FEATURE_MODEL_PATH, toLineaFeatureModel } from '../../linea/featureModelFormat.js';
import { Container } from 'typedi';
import { parseFeatureModel, normalizeUvl } from '../../linea/featureModel.js';
import AgentRunner from '../core/AgentRunner.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import AgentPolicyRepository from '../models/AgentPolicyRepository.js';
import AgentConfigRepository from '../models/AgentConfigRepository.js';
import HarvestDispositionRepository from '../models/HarvestDispositionRepository.js';
import TestResultRepository from '../models/TestResultRepository.js';
import KnowledgeService from '../knowledge/KnowledgeService.js';
import HarvestService from '../harvest/HarvestService.js';
import HarvestMergeService from '../harvest/HarvestMergeService.js';
import SyncResolveService from '../sync/SyncResolveService.js';
import MemoryService from '../memory/MemoryService.js';
import PlaygroundService from '../playground/PlaygroundService.js';
import LineService from '../../model/services/LineService.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';
import ProductService from '../../model/services/ProductService.js';
import { invalidateFmCache, loadFeatureModelFromBranch } from '../tools/splContext.js';
import { validateProductFm, validateHarvestFm } from '../sync/syncValidation.js';
import { listAgents } from '../core/AgentRegistry.js';
import { VERSIONED_KINDS, restoredBody, withRecordedVersion } from '../core/proposalVersions.js';
import { emitProposal, emitRun } from '../core/events.js';
import { productAccess, lineAccess, branches } from '../tools/git.js';
import { recheckMergeability } from '../tools/sync.js';
import { readLineModel, detectProductChanges, classifyChangeSignals, listPlatformFiles, isPlatformFile } from '../tools/harvest.js';
import { listBranches, getFile, getCommits } from '../../linea/repo.js';
import { extractScopeIds } from '../models/scopeQuery.js';
import { asyncHandler } from '../../rest/common/asyncHandler.js';
import * as ChangeSetProposalSession from '../changeset/ChangeSetProposalSession.js';
import ChangesetVersionService from '../changeset/ChangesetVersionService.js';
import ChangesetVersionRepository from '../models/ChangesetVersionRepository.js';

const MAX_DIFF_CHARS = 3000;

// Flatten a parsed FeatureModel into its list of feature names (root + descendants).
const collectFeatureNames = (root) => {
  const names = [];
  const walk = (node) => {
    if (!node) return;
    if (node.name) names.push(node.name);
    for (const child of node.features ?? []) walk(child);
  };
  walk(root);
  return [...new Set(names)];
};

/**
 * REST surface for the agent subsystem. Mirrors the existing controllers:
 * arrow-function handlers wrapped in `asyncHandler` so rejections reach the
 * shared onError middleware.
 *
 * Note: the deterministic tools the agents run (via LineService etc.) already
 * enforce per-user access levels, so an unauthorized run simply fails at
 * its first step rather than leaking data.
 */
export default class AgentController {
  runner = Container.get(AgentRunner);
  agentRunRepository = Container.get(AgentRunRepository);
  agentPolicyRepository = Container.get(AgentPolicyRepository);
  agentConfigRepository = Container.get(AgentConfigRepository);
  harvestDispositionRepository = Container.get(HarvestDispositionRepository);
  testResultRepository = Container.get(TestResultRepository);
  knowledgeService = Container.get(KnowledgeService);
  harvestService = Container.get(HarvestService);
  harvestMergeService = Container.get(HarvestMergeService);
  syncResolveService = Container.get(SyncResolveService);
  memoryService = Container.get(MemoryService);
  playgroundService = Container.get(PlaygroundService);
  lineService = Container.get(LineService);

  // Catalog of available agents.
  listAgents = asyncHandler(async (req, res) => {
    res.status(200).send(listAgents());
  });

  // Start a run. Body: { agentType, scope: { lineId?, productId? }, input? }
  createRun = asyncHandler(async (req, res) => {
    const { agentType, scope, input } = req.body;
    const run = await this.runner.enqueueNew({
      agentType,
      scope: scope ?? {},
      input: input ?? {},
      trigger: { kind: 'manual' },
      userId: req.userId,
    });
    res.status(201).send(run);
  });

  // List runs, filtered by scope if given, else the caller's own runs.
  listRuns = asyncHandler(async (req, res) => {
    const { lineId, productId } = req.query;
    const runs =
      lineId || productId
        ? await this.agentRunRepository.findByScope({ lineId, productId })
        : await this.agentRunRepository.findByCreatedBy(req.userId);
    res.status(200).send(runs);
  });

  getRun = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) {
      res.status(404).send({ error: 'errors.not_found' });
      return;
    }
    res.status(200).send(run);
  });

  // Approve/reject a pending proposal. Body: { proposalId?, decision, meta? }
  // `meta` is optional agent-specific metadata stored on the proposal body
  // (e.g. per-product overrides for the changeset plan_approval).
  decide = asyncHandler(async (req, res) => {
    const { proposalId, decision, meta } = req.body;
    // Trace override payloads so a future "why did cascade skip everything?"
    // question can be answered from the log alone.
    if (meta?.overrides) {
      console.log(`[decide] run=${req.params.id} overrides=${JSON.stringify(meta.overrides)}`);
    }
    const run = await this.runner.decideProposal({
      runId: req.params.id,
      proposalId,
      decision,
      meta,
      userId: req.userId,
    });
    res.status(200).send(run);
  });

  cancel = asyncHandler(async (req, res) => {
    const run = await this.runner.cancel(req.params.id);
    res.status(200).send(run);
  });

  deleteRun = asyncHandler(async (req, res) => {
    try {
      const result = await this.runner.deleteRun(req.params.id);
      if (!result.deleted) { res.status(404).send({ error: 'errors.not_found' }); return; }
      res.status(200).send(result);
    } catch (err) {
      res.status(409).send({ error: err?.message ?? 'errors.bad_request' });
    }
  });

  // Re-run one step of a terminal changeset. Body: { stepName }
  rerunStep = asyncHandler(async (req, res) => {
    const { stepName } = req.body ?? {};
    if (!stepName) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    try {
      const run = await this.runner.rerunStep(req.params.id, stepName);
      res.status(200).send(run);
    } catch (err) {
      res.status(409).send({ error: err?.message ?? 'errors.bad_request' });
    }
  });

  // Effective autonomy policy for a scope. Query: ?lineId=&productId=
  getPolicy = asyncHandler(async (req, res) => {
    const { lineId, productId } = req.query;
    const effective = await this.agentPolicyRepository.resolveEffective({
      lineId,
      productId: productId ?? null,
    });
    res.status(200).send(effective);
  });

  // Upsert a product- or line-level policy. Body: { lineId, productId?, criticality?, modes? }
  putPolicy = asyncHandler(async (req, res) => {
    const { lineId, productId, criticality, modes } = req.body;
    if (!lineId) {
      res.status(400).send({ error: 'errors.bad_request' });
      return;
    }
    const data = {};
    if (criticality) data.criticality = criticality;
    if (modes && typeof modes === 'object') {
      for (const [agent, mode] of Object.entries(modes)) data[`modes.${agent}`] = mode;
    }
    const policy = await this.agentPolicyRepository.upsertByScope(
      { lineId, productId: productId ?? null },
      data
    );
    res.status(200).send(policy);
  });

  // Effective per-agent customization for a scope, one entry per registered
  // agent (catalog merged with stored config). Query: ?lineId=&productId=
  getConfig = asyncHandler(async (req, res) => {
    const { lineId, productId } = req.query;
    if (!lineId) {
      res.status(400).send({ error: 'errors.bad_request' });
      return;
    }
    const catalog = listAgents();
    const entries = await Promise.all(
      catalog.map(async (agent) => {
        const { config, lineConfig, productConfig } =
          await this.agentConfigRepository.resolveEffectiveWithSource({
            lineId,
            productId: productId ?? null,
            agentType: agent.type,
          });
        return { ...agent, config, lineConfig, productConfig };
      })
    );
    res.status(200).send(entries);
  });

  // Delete one agent's config row for a scope. At product scope this resets the
  // agent to the line default. Query: ?lineId=&productId=&agentType=
  deleteConfig = asyncHandler(async (req, res) => {
    const lineId = req.query.lineId ?? req.body?.lineId;
    const productId = req.query.productId ?? req.body?.productId;
    const agentType = req.query.agentType ?? req.body?.agentType;
    if (!lineId || !agentType) {
      res.status(400).send({ error: 'errors.bad_request' });
      return;
    }
    await this.agentConfigRepository.deleteByScope({
      lineId,
      productId: productId ?? null,
      agentType,
    });
    res.status(204).send();
  });

  // Upsert one agent's config for a scope.
  // Body: { lineId, productId?, agentType, enabled?, instructions?, defaultInput?, triggers? }
  putConfig = asyncHandler(async (req, res) => {
    const { lineId, productId, agentType, enabled, instructions, defaultInput, memoryRead, memoryWrite, triggers } = req.body;
    if (!lineId || !agentType) {
      res.status(400).send({ error: 'errors.bad_request' });
      return;
    }
    const data = {};
    if (enabled !== undefined) data.enabled = enabled;
    if (instructions !== undefined) data.instructions = instructions;
    if (defaultInput !== undefined) data.defaultInput = defaultInput;
    if (memoryRead !== undefined) data.memoryRead = memoryRead;
    if (memoryWrite !== undefined) data.memoryWrite = memoryWrite;
    if (triggers && typeof triggers === 'object') {
      if (triggers.webhook !== undefined) data['triggers.webhook'] = triggers.webhook;
      if (triggers.schedule !== undefined) data['triggers.schedule'] = triggers.schedule;
    }
    const config = await this.agentConfigRepository.upsertByScope(
      { lineId, productId: productId ?? null, agentType },
      data
    );
    res.status(200).send(config);
  });

  // Semantic memory recall preview: top-K relevant memories for a query, with
  // similarity scores. Query: ?lineId=&productId=&q=&k=
  searchMemory = asyncHandler(async (req, res) => {
    const { lineId, productId, q, k } = req.query;
    if (!lineId || !q) {
      res.status(400).send({ error: 'errors.bad_request' });
      return;
    }
    const results = await this.memoryService.searchRelevant({
      lineId,
      productId: productId ?? null,
      queryText: q,
      k: Number(k) || undefined,
    });
    res.status(200).send(results);
  });

  // Refine a paused proposal via chat. Dispatches by the run's agent type:
  // Harvest revises its fm_patch; Sync revises its merge_resolution. Body: { message }
  refine = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) {
      res.status(404).send({ error: 'errors.not_found' });
      return;
    }
    const service = run.agentType === 'sync' ? this.syncResolveService : this.harvestService;
    const result = await service.refine({
      runId: req.params.id,
      userId: req.userId,
      message: req.body.message,
    });
    res.status(200).send(result);
  });

  // Revert a review proposal to an earlier version. Body: { proposalId?, versionIndex }
  restoreVersion = asyncHandler(async (req, res) => {
    const { proposalId, versionIndex } = req.body;
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) {
      res.status(404).send({ error: 'errors.not_found' });
      return;
    }
    if (run.status !== 'awaiting_approval') {
      res.status(409).send({ error: 'errors.bad_request' });
      return;
    }
    const proposal = proposalId
      ? run.proposals.id(proposalId)
      : run.proposals.find((p) => VERSIONED_KINDS.includes(p.kind) && !p.decision);
    if (!proposal) {
      res.status(404).send({ error: 'errors.not_found' });
      return;
    }
    proposal.body = restoredBody(proposal.body, Number(versionIndex), proposal.body?.title || 'current');
    run.markModified('proposals');
    await run.save();
    emitProposal(run, proposal);
    emitRun(run);
    res.status(200).send({ proposal });
  });

  // Manually author the content of one file on a paused review proposal — the
  // operator's fallback when the agent's auto-resolution is wrong or exhausted its
  // retries. Snapshots the prior body (so it stays revertible), flips the file's
  // confidence to 'manual', re-validates, and pushes the revised body via socket.
  // The approved commit/MR path is unchanged — it commits whatever fileEdits carry.
  // Body: { path, newContent }
  editProposalFile = asyncHandler(async (req, res) => {
    const { path, newContent } = req.body;
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.status !== 'awaiting_approval') { res.status(409).send({ error: 'errors.bad_request' }); return; }

    const proposal = run.proposals.find((p) => VERSIONED_KINDS.includes(p.kind) && !p.decision);
    if (!proposal) { res.status(404).send({ error: 'errors.not_found' }); return; }

    const edits = proposal.body?.fileEdits ?? [];
    if (!edits.some((e) => e.path === path)) { res.status(404).send({ error: 'errors.not_found' }); return; }

    const versions = withRecordedVersion(proposal.body, proposal.body?.title || 'before manual edit');
    const fileEdits = edits.map((e) =>
      e.path === path ? { ...e, newContent, confidence: 'manual' } : e
    );

    // Re-validate the feature model so a stale "valid" badge can't linger after a
    // hand edit. (A code edit can't change FM validity, but re-running is cheap and
    // keeps the displayed state honest.)
    const { lineId, productId } = extractScopeIds(run);
    let validation = proposal.body?.validation;
    try {
      if (run.agentType === 'sync') {
        validation = { fm: await validateProductFm({ productId, userId: req.userId }) };
      } else if (run.agentType === 'harvest') {
        validation = { fm: await validateHarvestFm({ lineId, userId: req.userId, newModelUvl: proposal.body?.newModelUvl }) };
      }
    } catch {
      // Non-fatal: keep the prior validation rather than blocking the edit.
    }

    proposal.body = { ...proposal.body, fileEdits, validation, versions };
    run.markModified('proposals');
    await run.save();
    emitProposal(run, proposal);
    emitRun(run);
    res.status(200).send({ proposal });
  });

  // Re-run FM validation on a paused run and push the result via socket.
  validateSync = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }

    const { lineId, productId } = extractScopeIds(run);
    let proposal, fm;
    if (run.agentType === 'sync') {
      proposal = run.proposals.find((p) => p.kind === 'merge_resolution' && !p.decision);
      if (!proposal) { res.status(404).send({ error: 'errors.not_found' }); return; }
      fm = await validateProductFm({ productId, userId: req.userId });
    } else if (run.agentType === 'harvest') {
      proposal = run.proposals.find((p) => p.kind === 'fm_patch' && !p.decision);
      if (!proposal) { res.status(404).send({ error: 'errors.not_found' }); return; }
      fm = await validateHarvestFm({ lineId, userId: req.userId, newModelUvl: proposal.body?.newModelUvl });
    } else {
      res.status(400).send({ error: 'errors.bad_request' }); return;
    }

    proposal.body = { ...proposal.body, validation: { fm } };
    run.markModified('proposals');
    await run.save();
    emitProposal(run, proposal);
    emitRun(run);
    res.status(200).send({ validation: { fm } });
  });

  // apply-resolution commits reconciled *content* to one branch, not an actual
  // merge — the git host's history-based conflict check can keep flagging the MR (or
  // start flagging it again after a later push) independent of that. The check
  // itself was already surfaced to the user, just never persisted: a manual
  // "Recheck" only ever updated local component state, so the Sync board (which
  // reads regen.result.conflicts, not the sync run's own result) and "Retry
  // resolver" stayed stuck on the original outcome forever, even after the git host
  // confirmed the conflict was gone. Persist the fresh check here instead, and
  // clear the regen's stale flag too so the board's bucketing follows along.
  recheckSyncConflict = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.agentType !== 'sync' || !run.result?.mr?.iid) {
      res.status(400).send({ error: 'errors.bad_request' }); return;
    }

    const { productId } = extractScopeIds(run);
    const { projectId } = await productAccess({ productId, userId: req.userId });
    const recheck = await recheckMergeability({ projectId, mrIid: run.result.mr.iid });

    if (recheck?.found) {
      run.result = {
        ...run.result,
        hasConflicts: recheck.hasConflicts,
        mr: { ...run.result.mr, hasConflicts: recheck.hasConflicts },
      };
      run.markModified('result');
      await run.save();
      emitRun(run);

      if (recheck.hasConflicts === false) {
        const regen = await this.agentRunRepository.model.findOne(
          { agentType: 'regen', 'scope.productId': productId },
          null,
          { sort: { createdAt: -1 } }
        );
        if (regen?.result?.conflicts) {
          regen.result = { ...regen.result, conflicts: false };
          regen.markModified('result');
          await regen.save();
          emitRun(regen);
        }
      }
    }

    res.status(200).send({ hasConflicts: recheck?.hasConflicts ?? null });
  });

  // Knowledge chat. Body: { lineId, threadId?, content }
  knowledgeMessage = asyncHandler(async (req, res) => {
    const { lineId, threadId, content } = req.body;
    const result = await this.knowledgeService.ask({
      lineId,
      userId: req.userId,
      threadId,
      content,
    });
    res.status(200).send(result);
  });

  knowledgeThreads = asyncHandler(async (req, res) => {
    const threads = await this.knowledgeService.listThreads({
      lineId: req.query.lineId,
      userId: req.userId,
    });
    res.status(200).send(threads);
  });

  knowledgeMessages = asyncHandler(async (req, res) => {
    const messages = await this.knowledgeService.getMessages({ threadId: req.params.id });
    res.status(200).send(messages);
  });

  // List memories for a scope. Query: ?lineId=&productId=&limit=
  listMemory = asyncHandler(async (req, res) => {
    const { lineId, productId, limit } = req.query;
    if (!lineId) {
      res.status(400).send({ error: 'errors.bad_request' });
      return;
    }
    const memories = await this.memoryService.listForScope({ lineId, productId, limit: Number(limit) || 50 });
    res.status(200).send(memories);
  });

  // Delete a single memory entry by id.
  deleteMemory = asyncHandler(async (req, res) => {
    await this.memoryService.deleteById(req.params.id);
    res.status(204).send();
  });

  // Delete all memories for a scope. Query: ?lineId=&productId=
  clearMemory = asyncHandler(async (req, res) => {
    const { lineId, productId } = req.query;
    if (!lineId) {
      res.status(400).send({ error: 'errors.bad_request' });
      return;
    }
    await this.memoryService.clearScope({ lineId, productId });
    res.status(204).send();
  });

  // Test the pending merge_resolution proposal's file edits against the product's test suite.
  // Streams progress via WebSocket; returns { jobId } immediately.
  testProposal = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.status !== 'awaiting_approval') { res.status(409).send({ error: 'errors.bad_request' }); return; }

    const proposal = run.proposals.find((p) => p.kind === 'merge_resolution' && !p.decision);
    if (!proposal) { res.status(404).send({ error: 'errors.not_found' }); return; }

    const { productId } = extractScopeIds(run);
    if (!productId) { res.status(400).send({ error: 'errors.bad_request' }); return; }

    const branch = proposal.target?.sourceBranch ?? 'main';
    const fileEdits = (proposal.body?.fileEdits ?? []).map((e) => ({
      path: e.path,
      action: e.action ?? 'update',
      newContent: e.newContent ?? '',
    }));

    const result = await this.playgroundService.testProposalEdits({
      userId: req.userId,
      productId,
      branch,
      fileEdits,
    });
    res.status(202).send(result);
  });

  // Start a sandbox test job for one product. Body: { productId, branch, featureSelection, overrideWithLineChanges, testCommand }
  playgroundTest = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.status !== 'awaiting_approval') {
      res.status(409).send({ error: 'errors.bad_request' }); return;
    }
    const { productId, branch = 'main', featureSelection = [], overrideWithLineChanges = true, testCommand = '', testImage = '', skipTests = false } = req.body;
    if (!productId) { res.status(400).send({ error: 'errors.bad_request' }); return; }

    const result = await this.playgroundService.runProductTest({
      runId: req.params.id,
      userId: req.userId,
      productId,
      branch,
      featureSelection,
      overrideWithLineChanges,
      testCommand,
      testImage,
      skipTests: Boolean(skipTests),
    });
    res.status(202).send(result);
  });

  // Return parsed FM trees (current + proposed) for the playground FM selector.
  playgroundFm = asyncHandler(async (req, res) => {
    const trees = await this.playgroundService.getFmTrees(req.params.id);
    res.status(200).send(trees);
  });

  // Download the derived+merged product as a zip. Body: { productId, branch, featureSelection, overrideWithLineChanges }
  playgroundDownload = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.status !== 'awaiting_approval') {
      res.status(409).send({ error: 'errors.bad_request' }); return;
    }
    const { productId, branch = 'main', featureSelection = [], overrideWithLineChanges = true } = req.body;
    if (!productId) { res.status(400).send({ error: 'errors.bad_request' }); return; }

    const { buffer, productName } = await this.playgroundService.generateDownloadZip({
      runId: req.params.id,
      userId: req.userId,
      productId,
      branch,
      featureSelection,
      overrideWithLineChanges,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${productName}-playground.zip"`);
    res.send(buffer);
  });

  // ── Plan-branch playground (sandbox flow on the changeset run) ─────────────

  /**
   * Resolve the plan/ branch a changeset run is iterating on. Falls back through
   * input.branch → plan step output → null. Returns null for legacy fm-edit runs
   * and for runs mistakenly created against the default branch (main).
   */
  #resolvePlanBranch = (run) => {
    const raw = run.input?.branch
      ?? (run.steps ?? []).find((s) => s.name === 'plan')?.output?.planBranch
      ?? null;
    if (!raw || raw === 'main') return null;
    return raw;
  };

  /**
   * In-memory sandbox state used whon the git host is unavailable or the run has no
   * plan/ branch. Keeps the editor exercisable end-to-end for demos, so the
   * user can see the FM, edit it, add platform files, and (mock-) commit
   * iterations without any git wiring.
   *
   * State is per-run, held only in this process — lost on restart. Fine for
   * demo. A real production flow always resolves to the real git branch.
   */
  #mockSandboxStates = new Map();

  #getOrSeedMockSandbox = (runId) => {
    const key = String(runId);
    if (!this.#mockSandboxStates.has(key)) {
      const shortId = key.slice(-8);
      this.#mockSandboxStates.set(key, {
        planBranch: `mock/plan-${shortId}`,
        fmPath: FEATURE_MODEL_PATH,
        fmType: 'UVL',
        fmContent:
          `features\n` +
          `    Root {abstract}\n` +
          `        mandatory\n` +
          `            Base\n` +
          `        optional\n` +
          `            OptionalFeature "Toggle-able optional feature."\n` +
          `\n` +
          `constraints\n`,
        files: new Map([
          ['src/platform/example.js',
            `// Example platform file (mock — git host not available).\n` +
            `// Edit me, add more files, and hit "Commit iteration" to persist to the mock.\n\n` +
            `export function example() {\n  return 'hello from the mock LPS';\n}\n`],
          ['src/platform/README.md',
            `# Mock LPS platform code\n\n` +
            `You are looking at an in-memory scaffold because the git host could not be reached\n` +
            `(or the run has no plan/ branch). All edits persist in memory for this run,\n` +
            `so the sandbox flow stays testable end-to-end.\n`],
        ]),
        commits: 0,
      });
    }
    return this.#mockSandboxStates.get(key);
  };

  // Read FM trees (current main + proposed branch) for the sandbox tab.
  playgroundBranchFm = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    const planBranch = this.#resolvePlanBranch(run);
    if (!planBranch) {
      // No working branch → nothing to diff. 200 with null trees so the client
      // stops treating it as an error in DevTools.
      res.status(200).send({ current: null, proposed: null, reason: 'no plan branch' });
      return;
    }
    try {
      const trees = await this.playgroundService.getFmTreesFromBranch({
        userId: req.userId,
        lineId: String(run.scope?.lineId ?? ''),
        planBranch,
      });
      res.status(200).send(trees);
    } catch (err) {
      // Branch missing / git host down / FM file absent on that ref → don't crash
      // the sandbox UI, return null trees. The FM textarea in SandboxTab still
      // works via /sandbox/state which has its own fallback.
      console.warn(`[sandbox] FM tree read failed for run ${req.params.id}: ${err?.message ?? err}`);
      res.status(200).send({ current: null, proposed: null, reason: err?.message ?? String(err) });
    }
  });

  // Run a sandbox test — attempts a real product build+test against the
  // resolved line branch (plan/ if present, otherwise main so an unmodified
  // line still exercises the pipeline end to end). Only if the real path
  // throws synchronously does the mock fallback kick in.
  playgroundBranchTest = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    const { productId, branch = 'main', featureSelection = [], overrideWithLineChanges = true, testCommand = '', testImage = '', skipTests = false } = req.body;
    if (!productId) { res.status(400).send({ error: 'errors.bad_request' }); return; }

    const planBranch = this.#resolvePlanBranch(run);
    const lineBranch = planBranch || 'main';

    try {
      const result = await this.playgroundService.runProductTestOnBranch({
        userId: req.userId,
        productId,
        lineBranch,
        branch,
        featureSelection,
        overrideWithLineChanges,
        testCommand,
        testImage,
        skipTests: Boolean(skipTests),
      });
      res.status(202).send({ ...result, usedLineBranch: lineBranch, mock: false });
    } catch (err) {
      console.warn(`[sandbox] real test start failed for ${req.params.id} (lineBranch=${lineBranch}), using mock:`, err?.message ?? err);
      const mockResult = this.playgroundService.runMockProductTest({
        userId: req.userId,
        productId,
        reason: planBranch
          ? 'Git host / Docker call failed'
          : 'no plan/ branch; falling back after main-branch attempt',
      });
      res.status(202).send(mockResult);
    }
  });

  // Download the derived product zip generated against the plan/ branch.
  playgroundBranchDownload = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    const planBranch = this.#resolvePlanBranch(run);
    if (!planBranch) { res.status(409).send({ error: 'errors.bad_request' }); return; }
    const { productId, branch = 'main', featureSelection = [], overrideWithLineChanges = true } = req.body;
    if (!productId) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const { buffer, productName } = await this.playgroundService.generateBranchDownloadZip({
      userId: req.userId,
      productId,
      lineBranch: planBranch,
      branch,
      featureSelection,
      overrideWithLineChanges,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${productName}-sandbox.zip"`);
    res.send(buffer);
  });

  /**
   * Return the current state of the sandbox for a changeset run.
   * Includes the plan/ branch name and the raw FM content as it sits on the
   * branch (so the client can edit the UVL in a textarea). Falls back to an
   * in-memory mock whon the git host is unreachable or the run has no plan/ branch,
   * so the sandbox editor stays usable for demos.
   */
  sandboxState = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.agentType !== 'changeset') { res.status(409).send({ error: 'errors.bad_request' }); return; }

    // If the sandbox step is already done, the plan/ branch was merged into
    // main and typically deleted by the git host. Anything served from a mock would
    // be misleading. Return a clear "already merged" state so the client can
    // show the completed banner instead of the editor.
    const sandboxStep = (run.steps ?? []).find((s) => s.name === 'sandbox');
    const sandboxFinished = sandboxStep && ['done', 'skipped'].includes(sandboxStep.status);

    const planBranch = this.#resolvePlanBranch(run);

    if (planBranch && !sandboxFinished) {
      try {
        const lineId = String(run.scope?.lineId ?? '');
        const { modelStr, type } = await loadFeatureModelFromBranch({
          lineId, userId: req.userId, branch: planBranch,
        });
        const modelPath = FEATURE_MODEL_PATH;
        res.status(200).send({
          planBranch,
          fm: { path: modelPath, content: modelStr, type },
          mock: false,
          sandboxFinished: false,
        });
        return;
      } catch (err) {
        console.warn(`[sandbox] git host load failed for run ${req.params.id}, using in-memory mock:`, err?.message ?? err);
      }
    }

    // Sandbox is finished OR the run has no plan branch → tell the client
    // clearly instead of silently mocking. The SandboxTab handles both.
    if (sandboxFinished) {
      res.status(200).send({
        planBranch: planBranch ?? null,
        fm: null,
        mock: false,
        sandboxFinished: true,
      });
      return;
    }

    const mock = this.#getOrSeedMockSandbox(req.params.id);
    res.status(200).send({
      planBranch: mock.planBranch,
      fm: { path: mock.fmPath, content: mock.fmContent, type: mock.fmType },
      mock: true,
      sandboxFinished: false,
    });
  });

  /**
   * List platform source files as they sit on the plan/ branch. Used by the
   * Sandbox Code tab to pick a file to edit.
   * Query: ?path=<prefix> — only files under it (default: all of the platform).
   */
  sandboxFiles = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.agentType !== 'changeset') { res.status(409).send({ error: 'errors.bad_request' }); return; }

    const requested = String(req.query.path ?? '');
    const treePath  = requested && isPlatformFile(requested) ? requested : '';
    const planBranch = this.#resolvePlanBranch(run);

    if (planBranch) {
      try {
        const { lineProjectId } = await lineAccess({
          lineId: String(run.scope?.lineId ?? ''), userId: req.userId,
        });
        const files = (await listPlatformFiles({ lineProjectId, ref: planBranch })).filter((f) => f.startsWith(treePath));
        res.status(200).send({ path: treePath, files, mock: false });
        return;
      } catch (err) {
        console.warn(`[sandbox] listing the files failed for run ${req.params.id}, using in-memory mock:`, err?.message ?? err);
      }
    }

    const mock = this.#getOrSeedMockSandbox(req.params.id);
    const files = [...mock.files.keys()].filter((p) => p.startsWith(treePath));
    res.status(200).send({ path: treePath, files, mock: true });
  });

  // Read one file from the plan/ branch — falls back to the in-memory mock.
  sandboxFile = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.agentType !== 'changeset') { res.status(409).send({ error: 'errors.bad_request' }); return; }

    const path = String(req.query.path ?? '');
    if (!isPlatformFile(path)) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const planBranch = this.#resolvePlanBranch(run);

    if (planBranch) {
      try {
        const { lineProjectId } = await lineAccess({
          lineId: String(run.scope?.lineId ?? ''), userId: req.userId,
        });
        const file = await getFile({ id: lineProjectId, path, ref: planBranch });
        if (file) {
          res.status(200).send({ path, content: Buffer.from(file.content, 'base64').toString('utf8'), mock: false });
          return;
        }
      } catch (err) {
        const status = err?.response?.status ?? err?.status ?? 500;
        if (status !== 404) {
          console.warn(`[sandbox] reading the file failed for run ${req.params.id} path ${path}, using in-memory mock:`, err?.message ?? err);
        }
      }
    }

    const mock = this.#getOrSeedMockSandbox(req.params.id);
    if (!mock.files.has(path)) { res.status(404).send({ error: 'errors.not_found' }); return; }
    res.status(200).send({ path, content: mock.files.get(path), mock: true });
  });

  /**
   * Commit one sandbox iteration onto the run's plan/ branch.
   * Body: { newModelUvl?, fileEdits?: [{ path, action, newContent }], message? }
   * Each commit is a new version of the plan — the branch history is the
   * audit trail of the sandbox iteration.
   */
  sandboxCommit = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }
    if (run.agentType !== 'changeset') { res.status(409).send({ error: 'errors.bad_request' }); return; }

    const { newModelUvl, fileEdits = [], message } = req.body ?? {};
    if (!newModelUvl && !fileEdits.length) {
      res.status(400).send({ error: 'errors.bad_request' }); return;
    }

    const planBranch = this.#resolvePlanBranch(run);

    if (planBranch) {
      try {
        const actions = [];
        if (newModelUvl) {
          const planStep = (run.steps ?? []).find((s) => s.name === 'plan');
          const modelPath = planStep?.output?.proposedModelPath
            ?? planStep?.output?.line?.modelPath
            ?? FEATURE_MODEL_PATH;
          // The line keeps its feature model as a model of its feature metamodel, not as UVL: LINEA converts it.
          const content = modelPath === FEATURE_MODEL_PATH
            ? await toLineaFeatureModel({ lineId: String(run.scope?.lineId), userId: req.userId, uvl: normalizeUvl({ uvl: newModelUvl }) })
            : newModelUvl;
          // (LINEA's plan-branch commits name the file `file_path`)
          actions.push({ action: 'update', file_path: modelPath, content });
        }
        for (const edit of fileEdits) {
          if (!edit?.path || edit.newContent == null) continue;
          actions.push({
            action: edit.action === 'create' ? 'create' : (edit.action === 'delete' ? 'delete' : 'update'),
            file_path: edit.path,
            content: edit.action === 'delete' ? undefined : edit.newContent,
          });
        }
        if (actions.length === 0) { res.status(400).send({ error: 'errors.bad_request' }); return; }

        await this.lineService.commitToPlanBranch({
          id: String(run.scope?.lineId ?? ''),
          userId: req.userId,
          branch: planBranch,
          actions,
          message: message?.trim() || `Sandbox iteration on ${planBranch}`,
        });
        invalidateFmCache(String(run.scope?.lineId ?? ''));
        res.status(200).send({ committed: true, branch: planBranch, mock: false });
        return;
      } catch (err) {
        console.warn(`[sandbox] the commit failed for run ${req.params.id}, falling back to in-memory mock:`, err?.message ?? err);
      }
    }

    const mock = this.#getOrSeedMockSandbox(req.params.id);
    if (newModelUvl) mock.fmContent = newModelUvl;
    for (const edit of fileEdits) {
      if (!edit?.path || edit.newContent == null) continue;
      if (edit.action === 'delete') mock.files.delete(edit.path);
      else mock.files.set(edit.path, edit.newContent);
    }
    mock.commits += 1;
    res.status(200).send({ committed: true, branch: mock.planBranch, mock: true, commits: mock.commits });
  });

  /**
   * Persist the current playground feature selection into the product's spec
   * so future regens include the feature-gated code. Body: { productId, featureSelection: [] }.
   * Only mutates `spec.features` — doesn't bump the version.
   */
  playgroundSaveSelection = asyncHandler(async (req, res) => {
    const { productId, featureSelection } = req.body ?? {};
    if (!productId || !Array.isArray(featureSelection)) {
      res.status(400).send({ error: 'errors.bad_request' }); return;
    }

    const product = await Container.get(ProductRepository).findById(productId);
    if (!product) { res.status(404).send({ error: 'errors.not_found' }); return; }

    // LINEA saves the selection: it makes the model of it, checks it against the feature model, and the spec follows.
    // The version is not bumped; the next generation does that.
    const features = [...new Set(featureSelection)];
    try {
      await Container.get(ProductService).saveSelection({ id: productId, userId: req.userId, features });
    } catch (err) {
      console.error('[save-selection] LINEA did not save the selection:', err?.message ?? err);
      res.status(err?.status >= 400 && err?.status < 500 ? err.status : 502).send({ error: err?.body?.error ?? 'errors.internal' });
      return;
    }
    console.log(`[save-selection] product ${productId} features=${JSON.stringify(features)}`);

    res.status(200).send({ saved: true, features: featureSelection });
  });

  // Cancel a running playground job. DELETE /runs/:id/playground/jobs/:jobId
  cancelPlaygroundJob = asyncHandler(async (req, res) => {
    const cancelled = this.playgroundService.cancelJob(req.params.jobId);
    if (!cancelled) { res.status(404).send({ error: 'errors.not_found' }); return; }
    res.status(200).send({ cancelled: true });
  });

  // Manually add a memory entry. Body: { lineId, productId?, kind, content }
  addMemory = asyncHandler(async (req, res) => {
    const { lineId, productId, kind, content } = req.body;
    if (!lineId || !kind || !content) {
      res.status(400).send({ error: 'errors.bad_request' }); return;
    }
    const memory = await this.memoryService.addManual({
      lineId,
      productId: productId ?? null,
      kind,
      content,
      userId: req.userId,
    });
    res.status(201).send(memory);
  });

  // Agent system metrics. Returns aggregated run stats. Optional ?windowDays= bounds the
  // performance window (latency/approval/time-series); defaults to 30, clamped to 1..365.
  getMetrics = asyncHandler(async (req, res) => {
    const raw = Number.parseInt(req.query.windowDays, 10);
    const windowDays = Number.isFinite(raw) ? Math.min(365, Math.max(1, raw)) : 30;
    const metrics = await this.agentRunRepository.computeMetrics({ windowDays });
    res.status(200).send(metrics);
  });

  // Webhook delivery log. Query: ?limit=
  listWebhookDeliveries = asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const WebhookDeliveryRepository = (await import('../models/WebhookDeliveryRepository.js')).default;
    const repo = Container.get(WebhookDeliveryRepository);
    const deliveries = await repo.findRecent(limit);
    res.status(200).send(deliveries);
  });

  // Recent commits on the product's default branch — used to populate the
  // "since a specific commit" picker in the harvest launch dialog. Query: ?productId=
  harvestCommits = asyncHandler(async (req, res) => {
    const { product } = await productAccess({
      productId: req.query.productId,
      userId: req.userId,
      });
    const commits = await getCommits({
      id: product.repo.id,
      ref: branches.default,
      perPage: 30,
    });
    // (the keys are the ones the pages already read)
    res.status(200).send(
      (commits ?? []).map((c) => ({
        id: c.shortId,
        short_id: c.shortId,
        title: c.title,
        author_name: c.authorName,
        created_at: c.createdAt,
      }))
    );
  });

  // ── Harvest candidate dispositions ──────────────────────────────────────────
  // Operator triage on miner candidates (dismiss / manually-harvested / snooze),
  // keyed by a stable candidate signature so they survive a fresh re-scan.

  // List dispositions for a line. Query: ?lineId=
  listDispositions = asyncHandler(async (req, res) => {
    const { lineId } = req.query;
    if (!lineId) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const rows = await this.harvestDispositionRepository.findByLine(lineId);
    res.status(200).send(rows);
  });

  // Upsert a disposition. Body: { lineId, signature, state, reason?, note?, mrUrl?,
  //   snoozeUntil?, representativeProductId?, suggestedType?, files? }
  putDisposition = asyncHandler(async (req, res) => {
    const {
      lineId, signature, state, reason, note, mrUrl, snoozeUntil,
      representativeProductId, suggestedType, files,
    } = req.body;
    const data = { state, decidedBy: req.userId, decidedAt: new Date() };
    if (reason !== undefined) data.reason = reason;
    if (note !== undefined) data.note = note;
    if (mrUrl !== undefined) data.mrUrl = mrUrl;
    if (snoozeUntil !== undefined) data.snoozeUntil = snoozeUntil ? new Date(snoozeUntil) : null;
    if (representativeProductId !== undefined) data.representativeProductId = representativeProductId || null;
    if (suggestedType !== undefined) data.suggestedType = suggestedType;
    if (files !== undefined) data.files = files;

    // Persist a line-scoped lesson so the next harvest run remembers this triage,
    // and keep its id on the row so a restore can clean it up. Best-effort: a memory
    // failure must not block the disposition write. Replacing an existing capture
    // (e.g. re-dismissing with a new reason) drops the stale lesson first.
    const existing = await this.harvestDispositionRepository.findBySignature({ lineId, signature });
    if (existing?.memoryId) {
      await this.memoryService.deleteById(existing.memoryId).catch(() => {});
    }
    const memoryId = await this.memoryService.captureDisposition({
      lineId, signature, state, reason, note, mrUrl, files, suggestedType,
    });
    data.memoryId = memoryId ?? null;

    const row = await this.harvestDispositionRepository.upsertBySignature({ lineId, signature }, data);
    res.status(200).send(row);
  });

  // Delete a disposition by id — un-dismiss / restore a candidate. Also removes the
  // lesson memory written at triage time so a restore fully undoes the decision.
  deleteDisposition = asyncHandler(async (req, res) => {
    const row = await this.harvestDispositionRepository.findById(req.params.id);
    if (row?.memoryId) {
      await this.memoryService.deleteById(row.memoryId).catch(() => {});
    }
    await this.harvestDispositionRepository.deleteById(req.params.id);
    res.status(204).send();
  });

  // Feature names from the line's platform feature model — powers the
  // target-feature dropdown in the harvest steering dialog. Query: ?lineId=
  getLineFeatures = asyncHandler(async (req, res) => {
    const { lineId } = req.query;
    if (!lineId) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const { lineProjectId } = await lineAccess({
      lineId,
      userId: req.userId,
    });
    const model = await readLineModel({ lineProjectId, lineId, userId: req.userId });
    const root = parseFeatureModel({ content: model.content, type: model.type });
    res.status(200).send({ type: model.type, features: collectFeatureNames(root) });
  });

  // Lazy diff preview for a candidate card. Query: ?productId=
  // Returns the product's direct changes + deterministic signals, fetched on expand.
  harvestPreview = asyncHandler(async (req, res) => {
    const { productId } = req.query;
    if (!productId) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const { projectId } = await productAccess({
      productId,
      userId: req.userId,
      });
    const changes = await detectProductChanges({ projectId });
    const signals = classifyChangeSignals({ files: changes.files, commits: changes.commits });
    res.status(200).send({
      files: (changes.files ?? []).map((f) => ({
        path: f.path,
        added: Boolean(f.added),
        deleted: Boolean(f.deleted),
        renamed: Boolean(f.renamed),
        diff: (f.diff ?? '').slice(0, MAX_DIFF_CHARS),
      })),
      signals,
    });
  });

  // Merge 2+ in-review harvest proposals into one new run. The merged run
  // re-synthesizes a unified proposal from the sources + the operator directive;
  // the sources are parked until accept or split. Body: { lineId, runIds, directive? }
  mergeHarvestProposals = asyncHandler(async (req, res) => {
    const { lineId, runIds, directive } = req.body;
    const run = await this.harvestMergeService.merge({
      lineId,
      runIds,
      directive,
      userId: req.userId,
    });
    res.status(201).send(run);
  });

  // Split a merged run back into its sources (only while it has not opened an MR).
  // Body: { runId }
  splitHarvestProposal = asyncHandler(async (req, res) => {
    const result = await this.harvestMergeService.split({
      runId: req.body.runId,
      userId: req.userId,
    });
    res.status(200).send(result);
  });

  // Run a product's own test suite (committed code at `branch`, no edits) and
  // persist the outcome. Streams playground:* events; returns { jobId }.
  // Body: { branch? }. Used by the Sync Console's per-product "Run tests".
  runProductTest = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    if (!productId) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const result = await this.playgroundService.runStandaloneProductTest({
      userId: req.userId,
      productId,
      branch: req.body?.branch || 'main',
    });
    res.status(202).send(result);
  });

  // Latest persisted test result per product for a line — powers the Sync
  // Console's test chips. Query param: :lineId.
  listTestResults = asyncHandler(async (req, res) => {
    const { lineId } = req.params;
    if (!lineId) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const rows = await this.testResultRepository.findLatestByLineId(lineId);
    res.status(200).send(rows);
  });

  // The branches of a repository, narrowed by a search text, as the pickers want them.
  async #branchList(repoId, search) {
    const text = String(search ?? '').toLowerCase();
    return (await listBranches({ id: repoId }))
      .filter((name) => name.toLowerCase().includes(text))
      .map((name) => ({ name, default: name === branches.default }));
  }

  // List the branches of a line repo. Query: ?search=  Used by the Consolidation "from branch" picker.
  listLineBranches = asyncHandler(async (req, res) => {
    const { lineId } = req.params;
    if (!lineId) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const { lineProjectId } = await lineAccess({ lineId, userId: req.userId});
    res.status(200).send(await this.#branchList(lineProjectId, req.query.search));
  });

  // List the branches of a product repo. Query: ?search=
  playgroundBranches = asyncHandler(async (req, res) => {
    const { product } = await productAccess({
      productId: req.params.productId,
      userId: req.userId,
      });
    res.status(200).send(await this.#branchList(product.repo.id, req.query.search));
  });

  // ── Consolidation "Propose with AI" — LLM-chat proposal sessions ─────────────

  startChangesetProposal = asyncHandler(async (req, res) => {
    const { lineId } = req.params;
    const { intent } = req.body;
    if (!lineId || !intent?.trim()) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const result = await ChangeSetProposalSession.startSession({ lineId, userId: req.userId, intent: intent.trim() });
    res.status(200).send(result);
  });

  refineChangesetProposal = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { message } = req.body;
    if (!sessionId || !message?.trim()) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const result = await ChangeSetProposalSession.refineSession({ sessionId, userId: req.userId, message: message.trim() });
    res.status(200).send(result);
  });

  commitChangesetProposal = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId) { res.status(400).send({ error: 'errors.bad_request' }); return; }
    const result = await ChangeSetProposalSession.commitSession({ sessionId, userId: req.userId });
    res.status(200).send(result);
  });

  // ── Version tree (new tree-first workspace) ─────────────────────────────

  listVersions = asyncHandler(async (req, res) => {
    const versions = await ChangesetVersionService.get().listByLine(req.params.lineId);
    res.status(200).send(versions);
  });

  createVersion = asyncHandler(async (req, res) => {
    const { lineId } = req.params;
    const { parentVersionId, intent, branch, origin } = req.body ?? {};
    const svc = ChangesetVersionService.get();
    try {
      const version = parentVersionId
        ? await svc.createForkFrom({ lineId, userId: req.userId, parentVersionId, intent })
        : await svc.createRootVersion({
            lineId,
            userId: req.userId,
            intent,
            origin: origin ?? 'llm',
            existingBranch: branch ?? null,
          });
      res.status(201).send(version);
    } catch (err) {
      console.error('[version:create]', err?.message ?? err);
      res.status(500).send({ error: err?.message ?? 'errors.internal' });
    }
  });

  getVersion = asyncHandler(async (req, res) => {
    const version = await ChangesetVersionService.get().get(req.params.versionId);
    if (!version) { res.status(404).send({ error: 'errors.not_found' }); return; }
    res.status(200).send(version);
  });

  archiveVersion = asyncHandler(async (req, res) => {
    const version = await Container.get(ChangesetVersionRepository).markStatus(req.params.versionId, 'archived');
    if (!version) { res.status(404).send({ error: 'errors.not_found' }); return; }
    try {
      const { emitVersion } = await import('../core/events.js');
      emitVersion(version, 'version-updated');
    } catch { /* best-effort */ }
    res.status(200).send(version);
  });

  promoteVersion = asyncHandler(async (req, res) => {
    try {
      const { version, run } = await ChangesetVersionService.get().promoteToPlan({
        versionId: req.params.versionId,
        userId: req.userId,
      });
      res.status(200).send({ version, run });
    } catch (err) {
      console.error('[version:promote]', err?.message ?? err);
      res.status(409).send({ error: err?.message ?? 'errors.bad_request' });
    }
  });

  // Hard-delete a version. Query ?cascade=1 deletes descendants too; without
  // cascade the call refuses if the version has children.
  deleteVersion = asyncHandler(async (req, res) => {
    const cascade = String(req.query.cascade ?? '') === '1' || req.query.cascade === 'true';
    try {
      const result = await ChangesetVersionService.get().deleteVersion({
        versionId: req.params.versionId,
        userId: req.userId,
        cascade,
      });
      res.status(200).send(result);
    } catch (err) {
      console.error('[version:delete]', err?.message ?? err);
      res.status(409).send({ error: err?.message ?? 'errors.bad_request' });
    }
  });

  // Reset a version: wipes chat and re-cuts the plan/ branch from the parent's
  // HEAD (or main). Body: `{ cascade: bool }` — when true, descendants are
  // deleted since their branches were forked from the state we just discarded.
  resetVersion = asyncHandler(async (req, res) => {
    const cascade = Boolean(req.body?.cascade);
    try {
      const version = await ChangesetVersionService.get().resetVersion({
        versionId: req.params.versionId,
        userId: req.userId,
        cascade,
      });
      res.status(200).send(version);
    } catch (err) {
      console.error('[version:reset]', err?.message ?? err);
      res.status(409).send({ error: err?.message ?? 'errors.bad_request' });
    }
  });

  getVersionChat = asyncHandler(async (req, res) => {
    const messages = await Container.get(ChangesetVersionRepository).chatMessages(req.params.versionId);
    res.status(200).send(messages);
  });

  postVersionChat = asyncHandler(async (req, res) => {
    const { versionId } = req.params;
    const { message } = req.body ?? {};
    if (!message?.trim()) { res.status(400).send({ error: 'errors.bad_request' }); return; }

    const repo = Container.get(ChangesetVersionRepository);
    const version = await repo.findById(versionId);
    if (!version) { res.status(404).send({ error: 'errors.not_found' }); return; }

    // Persist the user's message first — the reply below can take up to a
    // minute and the operator wants to see their message land immediately.
    await repo.appendChatMessage(versionId, { role: 'user', text: message.trim() });

    // Read the whole persisted history and pull the most recent assistant
    // proposal as the "prior state" for the next turn. That's how iteration
    // works: the LLM sees what it proposed before and refines it based on the
    // new user message.
    try {
      const history = await repo.chatMessages(versionId);
      const priorProposal = [...history].reverse().find(
        (m) => m.role === 'assistant' && m.proposalSnapshot?.reasoning
      )?.proposalSnapshot ?? null;

      const turn = await ChangeSetProposalSession.turnFromHistory({
        lineId:   String(version.lineId),
        userId:   req.userId,
        intent:   message.trim(),
        priorProposal,
      });

      // Commit the proposal to the version's plan/ branch so it's not lost
      // between chat turns. Each chat turn = a new commit on the branch. When
      // the user later promotes the version to a plan, the changeset agent
      // reads from that branch and sees exactly what the last turn produced.
      let commitSha = null;
      if (turn.proposal && (turn.proposal.newModelUvl || (turn.proposal.fileEdits ?? []).length)) {
        try {
          const actions = [];
          if (turn.proposal.newModelUvl && turn.modelInfo?.path) {
            actions.push({
              action: 'update',
              file_path: turn.modelInfo.path,
              content: turn.modelInfo.path.endsWith('.uvl')
                ? normalizeUvl({ uvl: turn.proposal.newModelUvl })
                : turn.proposal.newModelUvl,
            });
          }
          for (const edit of turn.proposal.fileEdits ?? []) {
            if (!edit?.path || edit.newContent == null) continue;
            actions.push({
              action: edit.action === 'create' ? 'create' : (edit.action === 'delete' ? 'delete' : 'update'),
              file_path: edit.path,
              content: edit.action === 'delete' ? undefined : edit.newContent,
            });
          }
          if (actions.length > 0) {
            const commitResult = await this.lineService.commitToPlanBranch({
              id: String(version.lineId),
              userId: req.userId,
              branch: version.branch,
              actions,
              message: `Chat turn: ${message.trim().slice(0, 60)}`,
            });
            commitSha = commitResult?.commit?.id ?? commitResult?.commitSha ?? null;
          }
        } catch (commitErr) {
          console.warn(`[version:chat] commit to ${version.branch} failed:`, commitErr?.message ?? commitErr);
        }
      }

      // Persist the assistant reply with the proposal snapshot + commit ref.
      const assistantMsg = await repo.appendChatMessage(versionId, {
        role: 'assistant',
        text: turn.proposal?.reasoning ?? turn.llmText ?? '',
        proposalSnapshot: turn.proposal ?? undefined,
        commitSha,
      });

      res.status(200).send({
        assistantMessage: assistantMsg,
        proposal: turn.proposal,
        llmText: turn.llmText,
        validation: turn.validation,
        modelInfo: turn.modelInfo,
      });
    } catch (err) {
      console.error('[version:chat]', err?.message ?? err);
      await repo.appendChatMessage(versionId, {
        role: 'system',
        text: `LLM error: ${err?.message ?? err}`,
      });
      res.status(500).send({ error: err?.message ?? 'errors.internal' });
    }
  });

  // Convert an in-review harvest proposal into a Consolidation Change Set run.
  // Commits the proposed FM + file edits to a plan branch, then enqueues a changeset run.
  createChangesetFromHarvest = asyncHandler(async (req, res) => {
    const run = await this.agentRunRepository.findById(req.params.id);
    if (!run) { res.status(404).send({ error: 'errors.not_found' }); return; }

    const REVIEW_KINDS = ['fm_patch', 'merge_resolution'];
    const proposal = (run.proposals ?? []).find((p) => REVIEW_KINDS.includes(p.kind) && !p.decision);
    if (!proposal?.body) { res.status(400).send({ error: 'errors.bad_request' }); return; }

    const lineId = run.scope?.lineId;
    if (!lineId) { res.status(400).send({ error: 'errors.bad_request' }); return; }

    const { lineProjectId } = await lineAccess({ lineId: String(lineId), userId: req.userId});
    const modelInfo = await readLineModel({ lineProjectId, lineId: String(lineId), userId: req.userId });

    const runIdShort = String(req.params.id).slice(-8);
    const syntheticProposal = {
      intent: `harvest-${runIdShort}`,
      newModelUvl: proposal.body.newModelUvl,
      fileEdits: proposal.body.fileEdits ?? [],
    };

    const branch = await ChangeSetProposalSession.createPlanBranch({ lineProjectId, modelInfo, proposal: syntheticProposal });

    const changesetRun = await this.runner.enqueueNew({
      agentType: 'changeset',
      scope: { lineId: String(lineId) },
      input: { origin: 'branch', branch },
      trigger: { kind: 'manual' },
      userId: req.userId,
    });

    res.status(201).send({ branch, runId: String(changesetRun._id) });
  });
}

Container.set(AgentController, new AgentController());
