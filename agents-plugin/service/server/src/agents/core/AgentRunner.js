import { runAs } from '../../linea/actingUser.js';
import { Container } from 'typedi';
import AgentRun from '../models/AgentRun.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import ApprovalGate from './ApprovalGate.js';
import { getAgent } from './AgentRegistry.js';
import { emitRun, emitStep, emitProposal } from './events.js';
import MemoryService from '../memory/MemoryService.js';
import AgentConfigRepository from '../models/AgentConfigRepository.js';
import { properties } from '../../model/connectors/properties.js';
import { runDurableToolLoop } from './toolLoop.js';
import { createRunQueue } from './runQueue.js';
import { withTimeout } from './timeout.js';

const STEP_TIMEOUTS = () => {
  const t = properties.ai?.stepTimeouts ?? {};
  return {
    llm: t.llm ?? 120000,
    git: t.git ?? 30000,
    deterministic: t.deterministic ?? 10000,
    // A product regeneration runs the full generate pipeline (download line +
    // product, run the engine, open + merge merge requests) — minutes, not seconds.
    regen: t.regen ?? 600000,
    // Sandbox test steps run Docker containers per product — per-product timeout
    // is controlled by properties.playground.testTimeoutMs; this step budget covers
    // a batch of up to 3 products run in parallel.
    playground: t.playground ?? 600000,
    // Per-turn budget for durable tool-loop steps. A multi-turn investigation is timed
    // turn by turn (not under the single `llm` budget), so a long but healthy loop is
    // not killed for taking many cheap turns.
    llmTurn: t.llmTurn ?? 90000,
    approval: 0, // approval steps are human-gated, never timed out
  };
};

const TERMINAL = ['done', 'failed', 'cancelled'];

/**
 * The orchestrator. An in-process queue advances each run step by step, persists
 * after every step (our hand-rolled checkpoint), streams the timeline over
 * Socket.IO, and pauses at approval gates. Resume re-enters at the saved cursor —
 * so a run survives a server restart (see `recover`).
 *
 * Runs are processed one at a time, which keeps writes to a single AgentRun doc
 * race-free. If throughput ever demands it, swap the in-memory queue for BullMQ
 * behind this same interface.
 */
export default class AgentRunner {
  agentRunRepository = Container.get(AgentRunRepository);
  approvalGate = Container.get(ApprovalGate);
  memoryService = Container.get(MemoryService);
  agentConfigRepository = Container.get(AgentConfigRepository);

  // Bounded-concurrency run queue (see core/runQueue.js). Distinct runs are independent
  // Mongo docs, so advancing several at once is safe; the queue guarantees the *same*
  // run is never advanced twice concurrently and that parent wakes are never lost. Set
  // ai.maxConcurrentRuns to 1 to reproduce the old strictly-serial behaviour.
  #runQueue = createRunQueue({
    advance: (runId) => this.#advance(runId),
    maxConcurrency: () => properties.ai?.maxConcurrentRuns ?? 3,
  });

  // Serializes the sync dedup check-then-create below per productId. A plain
  // read-then-write there is a TOCTOU race: two triggers (e.g. a webhook and a
  // manual retry click) landing within the same DB round-trip can both see no
  // active run and both create one — the exact "two independent sync runs for
  // one conflict" bug that check was added to prevent. Single-process only
  // (matches the queue's own single-Node-instance assumption above).
  #syncEnqueueChains = new Map();

  // ---- public API -------------------------------------------------------

  // `autonomyMode` — optional explicit mode (manual|semi|automatic) stamped directly
  // on the run, bypassing the saved policy. Used when the cascade fans autonomy out to
  // child runs, or when the user sets a per-run mode on the plan-approval card.
  enqueueNew = async ({ agentType, scope = {}, input = {}, trigger, userId, parentRunId, autonomyMode }) => {
    const def = getAgent(agentType);
    if (!def) throw new Error(`Unknown agent type: ${agentType}`);

    // Per-scope customization: refuse disabled agents (manual callers get the
    // error; auto-triggers catch and skip) and fill blank inputs from presets.
    const config = await this.#resolveConfig(agentType, scope);
    if (config.enabled === false) {
      throw new Error(`Agent "${agentType}" is disabled for this scope`);
    }
    const mergedInput = { ...(config.defaultInput ?? {}), ...input };

    const createRun = async () => {
      const run = new AgentRun({
        agentType,
        scope,
        input: mergedInput,
        trigger: trigger ?? { kind: 'manual' },
        createdBy: userId,
        parentRunId,
        status: 'queued',
        ...(autonomyMode ? { autonomyMode } : {}),
      });
      await run.save();
      emitRun(run);

      this.#enqueue(String(run._id));
      return run;
    };

    // Every sync-launching path — the auto-enqueue off a conflicted regen, the
    // manual "Diagnose sync"/"Retry resolver" buttons, the dashboard's "needs
    // attention" list — ends up here, and none of them reliably know about each
    // other (client-side guards only check a locally-cached, eventually-consistent
    // run list). Reuse the already-active run for the same product instead of
    // piling up a second one that has nothing to reconcile the first with — this
    // was producing two independent sync runs for one conflict, only one of which
    // any given view would show, silently burying the other's pending decision.
    if (agentType === 'sync' && scope.productId) {
      const key = String(scope.productId);
      // Chain onto any check-then-create already in flight for this product so
      // concurrent callers serialize instead of racing the same read-then-write.
      const prior = this.#syncEnqueueChains.get(key) ?? Promise.resolve();
      const chained = prior.catch(() => {}).then(async () => {
        const existing = await this.agentRunRepository.findActiveRun({
          agentType: 'sync', scopeField: 'productId', scopeValue: scope.productId,
        });
        return existing ?? createRun();
      });
      this.#syncEnqueueChains.set(key, chained);
      try {
        return await chained;
      } finally {
        if (this.#syncEnqueueChains.get(key) === chained) this.#syncEnqueueChains.delete(key);
      }
    }

    return createRun();
  };

  // Resume a run that was paused at an approval gate (proposal already decided).
  resume = async (runId) => {
    const run = await this.agentRunRepository.findById(runId);
    if (!run || run.status !== 'awaiting_approval') return run;
    run.status = 'queued';
    await run.save();
    emitRun(run);
    this.#enqueue(String(run._id));
    return run;
  };

  /**
   * Re-run a single step. Rewinds the cursor to that step's index, drops the
   * step doc + everything after it, and re-enqueues the run so the executor
   * picks it up from that point.
   *
   * Allowed statuses:
   *  - terminal (done / failed / cancelled) — normal retry after a timeout.
   *  - awaiting_approval — the user wants to redo an earlier step instead of
   *    deciding the current gate. The pending proposal is dropped along with
   *    its step so it can be re-created.
   *
   * Refused for actively running / awaiting_child / awaiting_external so we
   * don't race the executor.
   */
  rerunStep = async (runId, stepName) => {
    const run = await this.agentRunRepository.findById(runId);
    if (!run) throw new Error('Run not found');

    const RERUNNABLE = [...TERMINAL, 'awaiting_approval'];
    if (!RERUNNABLE.includes(run.status)) {
      throw new Error(`Cannot rerun a step while the run is ${run.status}. Cancel it first.`);
    }

    const stepIdx = (run.steps ?? []).findIndex((s) => s.name === stepName);
    if (stepIdx < 0) throw new Error(`Step "${stepName}" does not exist on this run.`);

    // Reset the target step and drop everything after it. Preserving earlier
    // step outputs is important — later steps depend on them.
    run.steps = run.steps.slice(0, stepIdx);

    // Drop proposals that were emitted at or after the rewind point. Anything
    // decided *before* the rewind point stays — resurrected steps still read
    // those (e.g. merge-branch reads the plan_approval decision).
    run.proposals = (run.proposals ?? []).filter((p) => {
      // Proposals written after this field was added carry the exact step
      // name that created them — match directly.
      if (p.stepName) return p.stepName !== stepName;
      // Older proposals predate `stepName`: fall back to matching the
      // human-facing "Phase N · Name" string against the step name.
      const phase = p.body?.phase;
      if (!phase) return true;
      return phase.replace(/^Phase\s+\d+\s*·\s*/, '').toLowerCase().replace(/\s+/g, '-') !== stepName;
    });

    run.cursor = stepIdx;
    run.status = 'queued';
    run.error = null;
    run.markModified('steps');
    run.markModified('proposals');
    await run.save();
    emitRun(run);
    this.#enqueue(String(run._id));
    return run;
  };

  cancel = async (runId) => {
    const run = await this.agentRunRepository.findById(runId);
    if (!run || TERMINAL.includes(run.status)) return run;
    run.status = 'cancelled';
    await run.save();
    emitRun(run);
    this.#notifyParent(run);
    return run;
  };

  /**
   * Hard-delete a run and its children. Only terminal runs (done / failed /
   * cancelled) may be deleted — refuse while something is still executing.
   */
  deleteRun = async (runId) => {
    const run = await this.agentRunRepository.findById(runId);
    if (!run) return { deleted: false, reason: 'not_found' };
    if (!TERMINAL.includes(run.status)) {
      throw new Error(`Cannot delete a ${run.status} run — cancel it first.`);
    }
    const children = await this.agentRunRepository.findByParentRunId(run._id);
    for (const child of children) {
      if (child) await this.agentRunRepository.deleteById(child._id);
    }
    await this.agentRunRepository.deleteById(run._id);
    return { deleted: true, id: String(run._id) };
  };

  // Record a human decision on a pending proposal, then resume (approve) or
  // cancel (reject) the run. The single place proposal decisions are written.
  // `meta` is optional agent-specific metadata (e.g. { overrides: { productId: 'skip' } }
  // for changeset plan_approval); it is merged into proposal.body.decisionMeta so
  // subsequent steps can read it via ctx.getProposals().
  decideProposal = async ({ runId, proposalId, decision, meta, userId }) => {
    if (!['approved', 'rejected'].includes(decision)) {
      throw new Error(`Invalid decision: ${decision}`);
    }
    const run = await this.agentRunRepository.findById(runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'awaiting_approval') {
      throw new Error('Run is not awaiting approval');
    }

    const proposal = proposalId
      ? run.proposals.id(proposalId)
      : run.proposals.find((p) => !p.decision);
    if (!proposal) throw new Error('Proposal not found');

    proposal.decision = decision;
    proposal.decidedBy = userId;
    proposal.decidedAt = new Date();
    if (meta && typeof meta === 'object') {
      proposal.body = { ...(proposal.body ?? {}), decisionMeta: meta };
      // If the plan-approval card included an autonomy selection, stamp it on the run
      // so the cascade step and ApprovalGate use it for all subsequent decisions.
      const autonomyDefault = meta.autonomy?.default;
      if (autonomyDefault && ['manual', 'semi', 'automatic'].includes(autonomyDefault)) {
        run.autonomyMode = autonomyDefault;
      }
    }
    run.markModified('proposals');
    await run.save();

    const config = await this.#resolveConfig(run.agentType, run.scope ?? {});
    void this.memoryService.captureDecision({ run, proposal, decision, writeMode: config.memoryWrite });

    return decision === 'approved' ? await this.resume(runId) : await this.cancel(runId);
  };

  // Boot recovery: re-enqueue anything left mid-flight by a crash/restart.
  recover = async () => {
    const stuck = await this.agentRunRepository.findResumable();
    for (const run of stuck) {
      run.status = 'queued';
      await run.save();
      this.#enqueue(String(run._id));
    }
    if (stuck.length) console.log(`[agents] recovered ${stuck.length} run(s)`);
  };

  // ---- queue worker -----------------------------------------------------

  #enqueue(runId) {
    this.#runQueue.enqueue(runId);
  }

  // When a child run reaches a terminal state, wake its parent batch so it can
  // process the next item. (No-op for ordinary runs.)
  #notifyParent(run) {
    if (run.parentRunId) this.#enqueue(String(run.parentRunId));
  }

  // Effective per-scope config for an agent. Best-effort: on any failure return
  // permissive defaults so a config lookup never blocks a run.
  async #resolveConfig(agentType, scope = {}) {
    try {
      return await this.agentConfigRepository.resolveEffective({
        lineId: scope.lineId ? String(scope.lineId) : null,
        productId: scope.productId ? String(scope.productId) : null,
        agentType,
      });
    } catch {
      return { enabled: true, instructions: '', defaultInput: {}, memoryRead: 'product_line', memoryWrite: 'run', triggers: {} };
    }
  }

  // A natural-language description of the run, embedded as the query vector for
  // semantic memory recall. Combines the agent's purpose (title + description) with
  // every string input on the run, so the query carries both domain context and the
  // run's specifics — richer text yields a more discriminating query embedding than
  // a bare list of input values.
  #memoryQuery(run) {
    const def = getAgent(run.agentType);
    const inputText = Object.values(run.input ?? {})
      .filter((v) => typeof v === 'string' && v.trim())
      .join(' ');
    return [def?.title, def?.description, inputText]
      .filter(Boolean)
      .join(' ')
      .slice(0, 600);
  }

  // Everything a run does to LINEA it does as the person who created it (see linea/actingUser.js).
  async #advance(runId) {
    const run = await this.agentRunRepository.findById(runId);
    return runAs(run?.createdBy, () => this.#advanceRun(runId));
  }

  async #advanceRun(runId) {
    let run = await this.agentRunRepository.findById(runId);
    if (!run || TERMINAL.includes(run.status)) return;

    const def = getAgent(run.agentType);
    if (!def) {
      run.status = 'failed';
      run.error = `Unknown agent type: ${run.agentType}`;
      await run.save();
      emitRun(run);
      return;
    }

    run.status = 'running';
    await run.save();
    emitRun(run);

    const lineId = run.scope?.lineId ? String(run.scope.lineId) : null;
    const productId = run.scope?.productId ? String(run.scope.productId) : null;

    // Resolve per-scope customization once per advancement (instructions injected
    // into every LLM step via ctx.config).
    const config = await this.#resolveConfig(run.agentType, run.scope ?? {});

    // Pre-load memories once per advancement so all LLM steps in this run share
    // them. Semantic recall ranks by relevance to this run; falls back to recency
    // when no embeddings provider is configured.
    let runMemories = [];
    try {
      runMemories = await this.memoryService.retrieveRelevant({
        lineId,
        productId,
        agentType: run.agentType,
        queryText: this.#memoryQuery(run),
        readScope: config.memoryRead,
      });
    } catch { /* best-effort — never block a run for memory load failures */ }

    for (let i = run.cursor; i < def.steps.length; i++) {
      const stepDef = def.steps[i];

      // A concurrent cancel() saves its own fresh copy of the run mid-loop; this
      // in-memory `run` doesn't see it. Without this check, the next `run.save()`
      // below would blindly overwrite the DB's 'cancelled' status back to
      // 'running'/'done', letting a cancelled run keep executing steps — including
      // irreversible ones like merge-branch.
      if (await this.agentRunRepository.isCancelled(run._id)) return;

      // Resume-friendly: if a crash/restart left an in-flight entry for this step that
      // carries a durable tool-loop checkpoint, reuse it so the loop continues from its
      // saved conversation instead of starting over (and the timeline shows no duplicate).
      const last = run.steps[run.steps.length - 1];
      let stepDoc;
      if (last && last.name === stepDef.name && last.status === 'running' && last.loop) {
        stepDoc = last;
      } else {
        run.steps.push({
          name: stepDef.name,
          kind: stepDef.kind ?? 'deterministic',
          status: 'running',
          startedAt: new Date(),
        });
        stepDoc = run.steps[run.steps.length - 1];
      }
      await run.save();
      emitStep(run, stepDoc);

      let outcome;
      try {
        const timeouts = STEP_TIMEOUTS();
        // Tool-loop steps (`toolLoop: true`) drive a durable multi-turn loop that times
        // each turn itself via STEP_TIMEOUTS().llmTurn — so the whole-step timeout is
        // disabled for them; otherwise a long-but-healthy investigation would be killed.
        // Per-step override wins over kind default: use it for steps whose duration
        // is a function of scope size (deploy loops over N products, for example).
        const timeoutMs = stepDef.toolLoop
          ? 0
          : (stepDef.timeoutMs ?? timeouts[stepDef.kind ?? 'deterministic'] ?? 0);
        outcome = (await withTimeout(
          stepDef.run(this.#buildContext(run, runMemories, config, stepDoc)),
          timeoutMs,
          stepDef.name
        )) ?? {};
      } catch (err) {
        stepDoc.status = 'failed';
        stepDoc.endedAt = new Date();
        stepDoc.durationMs = stepDoc.startedAt ? stepDoc.endedAt - stepDoc.startedAt : null;
        stepDoc.error = err?.message ?? String(err);
        run.status = 'failed';
        run.error = err?.message ?? String(err);
        run.markModified('steps');
        await run.save();
        emitStep(run, stepDoc);
        emitRun(run);
        this.#notifyParent(run);
        return;
      }

      // Re-check after the (possibly long) step call: a cancel() that landed while
      // the step was in flight must not be clobbered by the writes below.
      if (await this.agentRunRepository.isCancelled(run._id)) return;

      stepDoc.status = 'done';
      stepDoc.endedAt = new Date();
      stepDoc.durationMs = stepDoc.startedAt ? stepDoc.endedAt - stepDoc.startedAt : null;
      stepDoc.outputSummary = outcome.output ?? null;

      // A step can spawn a child run and wait for it: pause as 'awaiting_child'
      // WITHOUT advancing the cursor, so this same step re-runs when the child
      // reaches a terminal state (the runner re-enqueues this parent then).
      if (outcome.awaitChild) {
        run.status = 'awaiting_child';
        run.markModified('steps');
        await run.save();
        emitStep(run, stepDoc);
        emitRun(run);
        return;
      }

      // A step can pause waiting for an external async process (e.g. a CI pipeline)
      // WITHOUT advancing the cursor. A poller re-enqueues this run when the process finishes,
      // at which point this same step re-runs and checks the external state.
      if (outcome.awaitExternal) {
        run.status = 'awaiting_external';
        run.markModified('steps');
        await run.save();
        emitStep(run, stepDoc);
        emitRun(run);
        return;
      }

      run.cursor = i + 1;

      // A step may set the run's final result.
      if (outcome.result !== undefined) {
        run.result = outcome.result;
        run.markModified('result');
      }

      // A step that proposes a write goes through the approval gate.
      if (outcome.proposal) {
        const { outcome: gate, reason } = await this.approvalGate.decide({ run, proposal: outcome.proposal });
        run.proposals.push({
          ...outcome.proposal,
          stepName: stepDef.name,
          decision: gate === 'auto' ? 'auto' : undefined,
          // Record why a human is being asked, so the Inbox can explain the pause.
          pauseReason: gate === 'require' ? reason : undefined,
        });
        const proposalDoc = run.proposals[run.proposals.length - 1];

        if (gate === 'require') {
          run.status = 'awaiting_approval';
          run.markModified('steps');
          run.markModified('proposals');
          await run.save();
          emitStep(run, stepDoc);
          emitProposal(run, proposalDoc);
          emitRun(run);
          return; // pause here until a human decides
        }

        if (gate === 'auto') {
          void this.memoryService.captureDecision({ run, proposal: proposalDoc, decision: 'auto', writeMode: config.memoryWrite });
        }
        run.markModified('proposals');
        await run.save();
        emitStep(run, stepDoc);
        emitProposal(run, proposalDoc);
        continue;
      }

      run.markModified('steps');
      await run.save();
      emitStep(run, stepDoc);
    }

    run.status = 'done';
    await run.save();
    emitRun(run);
    void this.memoryService.captureRunOutcome({ run, writeMode: config.memoryWrite });
    // Harvest completion with an opened MR → auto-open a down-flow ChangeSet so
    // the new optional feature reaches every product in the family (plan §Phase 0,
    // "the missing link: up→down loop closer"). Fires after memory capture so the
    // harvest outcome is already recorded when the changeset plan step runs.
    if (run.agentType === 'harvest' && run.result?.opened === true) {
      void this.#triggerHarvestChangeSet(run);
    }
    // Changeset that successfully merged its plan branch to main → mark the
    // linked version as merged so the next created version starts a new epoch.
    if (run.agentType === 'changeset' && run.input?.versionId) {
      const mergeStep = (run.steps ?? []).find((s) => s.name === 'merge-branch');
      const merged = mergeStep?.outputSummary?.merged;
      if (merged) {
        try {
          const { default: ChangesetVersionService } = await import('../changeset/ChangesetVersionService.js');
          await ChangesetVersionService.get().markMerged(run.input.versionId);
        } catch (err) {
          console.warn('[agents] changeset→version markMerged failed:', err?.message ?? err);
        }
      }
    }
    this.#notifyParent(run);
  }

  // After a harvest run opens a branch+MR on the line repo, open a down-flow
  // ChangeSet to cascade the new optional feature into every product. Passes the
  // harvest branch so the changeset plan reads from the branch (not main) and
  // the merge-branch step can merge it into main. Best-effort.
  async #triggerHarvestChangeSet(run) {
    try {
      const lineId = run.scope?.lineId ? String(run.scope.lineId) : null;
      if (!lineId) return;
      // The harvest open-mr step stores the branch in its result.
      const branch = run.result?.branch ?? null;
      const userId = run.createdBy ? String(run.createdBy) : null;

      // Register the harvest as a version on the line's tree so the operator
      // sees it in the version-tree workspace (X+1.1 or 0.1 depending on state).
      let versionId = null;
      try {
        const { default: ChangesetVersionService } = await import('../changeset/ChangesetVersionService.js');
        const version = await ChangesetVersionService.get().createFromHarvest({
          lineId, userId, harvestBranch: branch,
          harvestRunId: String(run._id),
          featureName:  run.result?.featureName ?? null,
        });
        versionId = String(version._id);
      } catch (err) {
        console.warn('[agents] harvest→version create failed (continuing without version):', err?.message ?? err);
      }

      await this.enqueueNew({
        agentType: 'changeset',
        scope:     { lineId },
        input: {
          origin:  'harvest-accepted',
          branch,
          versionId,
          trigger: {
            harvestRunId: String(run._id),
            featureName:  run.result?.featureName ?? null,
          },
        },
        trigger:  { kind: 'parent_run', payload: { harvestRunId: String(run._id) } },
        userId,
      });
    } catch (err) {
      console.warn('[agents] harvest→changeset trigger failed:', err?.message ?? String(err));
    }
  }

  // Durable multi-turn tool loop. Delegates to the injectable `runDurableToolLoop`
  // helper, wiring the checkpoint to `run.save()` and the stream to `emitStep`. The
  // loop's conversation, turn cursor and transcript live on `stepDoc.loop`, persisted
  // after every turn — so it survives a restart and each turn is timed independently.
  async #runDurableToolLoop({ run, stepDoc, system, messages, tools, executeTool, maxTurns, maxTokens, memories, instructions }) {
    if (!stepDoc) throw new Error('runToolLoop is only available inside an agent step');
    return runDurableToolLoop({
      stepDoc,
      checkpoint: () => {
        run.markModified('steps');
        return run.save();
      },
      emit: () => emitStep(run, stepDoc),
      turnTimeout: STEP_TIMEOUTS().llmTurn,
      system,
      messages,
      tools,
      executeTool,
      maxTurns,
      maxTokens,
      memories,
      instructions,
    });
  }

  // The execution context handed to each step. State that must survive a pause
  // lives in the persisted run (read prior outputs via getStepOutput), never in
  // closure memory — a resumed run may run in a fresh process.
  #buildContext(run, memories = [], config = {}, stepDoc = null) {
    return {
      run,
      lineId: run.scope?.lineId ? String(run.scope.lineId) : null,
      productId: run.scope?.productId ? String(run.scope.productId) : null,
      userId: run.createdBy ? String(run.createdBy) : null,
      input: run.input ?? {},
      memories,
      // Recall memories against a step-specific query. Run-level `memories` are
      // pre-loaded once from the run input — too coarse for a step whose key signal
      // (e.g. the conflicting files) only emerges mid-run. This lets a step ask
      // "how were *these files* handled before", respecting the same memoryRead
      // config. Best-effort: returns [] on any failure, never blocks a step.
      recall: async (queryText, { k } = {}) => {
        try {
          if (!queryText?.trim()) return [];
          return await this.memoryService.retrieveRelevant({
            lineId: run.scope?.lineId ? String(run.scope.lineId) : null,
            productId: run.scope?.productId ? String(run.scope.productId) : null,
            agentType: run.agentType,
            queryText,
            ...(k ? { k } : {}),
            readScope: config.memoryRead,
          });
        } catch {
          return [];
        }
      },
      // Durable multi-turn tool loop. Checkpoints the conversation into the current
      // step after every turn, times each turn via STEP_TIMEOUTS().llmTurn, streams a
      // transcript to the timeline, and resumes from the saved convo after a restart.
      // Steps that call this MUST declare `toolLoop: true` so the runner disables the
      // whole-step timeout. Memories/instructions default to the run's resolved values.
      runToolLoop: ({ system, messages, tools, executeTool, maxTurns = 8, maxTokens }) =>
        this.#runDurableToolLoop({
          run,
          stepDoc,
          system,
          messages,
          tools,
          executeTool,
          maxTurns,
          maxTokens,
          memories,
          instructions: config.instructions ?? '',
        }),
      // Per-scope customization for this agent (see AgentConfig). `instructions`
      // is surfaced directly for convenience at LLM call sites.
      config,
      instructions: config.instructions ?? '',
      getStepOutput: (name) => {
        for (let i = run.steps.length - 1; i >= 0; i--) {
          const s = run.steps[i];
          if (s.name === name && s.status === 'done') return s.outputSummary;
        }
        return null;
      },
      getProposals: () => run.proposals,
      // Spawn a child run linked back to this run. Generic orchestration primitive
      // for agents that need to fan out work into awaited sub-runs.
      // `autonomyMode` is passed explicitly so the cascade can stamp each child with
      // the per-product or plan-default autonomy mode (manual|semi|automatic).
      spawnChild: ({ agentType, scope, input, autonomyMode }) =>
        this.enqueueNew({
          agentType,
          scope,
          input,
          userId: run.createdBy ? String(run.createdBy) : null,
          trigger: { kind: 'parent_run', payload: { parentRunId: String(run._id) } },
          parentRunId: run._id,
          ...(autonomyMode ? { autonomyMode } : {}),
        }),
      // Re-enqueue this run after an awaiting_external pause (poller callback).
      // Sets status back to queued so #advance continues from the same step.
      resumeFromExternal: async () => {
        const fresh = await this.agentRunRepository.findById(String(run._id));
        if (!fresh || fresh.status !== 'awaiting_external') return;
        fresh.status = 'queued';
        await fresh.save();
        emitRun(fresh);
        this.#enqueue(String(fresh._id));
      },
    };
  }
}

Container.set(AgentRunner, new AgentRunner());
