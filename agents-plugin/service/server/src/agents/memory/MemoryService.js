import { Container } from 'typedi';
import AgentMemoryRepository from '../models/AgentMemoryRepository.js';
import EmbeddingService, { cosineSimilarity } from './EmbeddingService.js';
import { complete } from '../core/llm.js';

// How many memories are injected into a run's system prompt. Kept small to stay
// within the token budget — RAG picks the *most relevant* ones, not just recent.
const MEMORY_LIMIT = 10;
// Top-K relevant memories retrieved per run when embeddings are available.
// Kept small so we don't stuff N kB of past decisions into every prompt.
const RAG_K = 4;
// Recency-ordered candidate pool that cosine ranking scores against. A few
// hundred comfortably covers a scope's history while keeping in-Node scoring cheap.
const CANDIDATE_POOL = 300;
// Minimum cosine similarity for a memory to be injected into a run's prompt.
// Below this, a memory is more noise than signal — better to inject fewer, highly
// relevant memories than to pad the prompt with loosely related ones. The UI recall
// preview is NOT thresholded (it shows weak matches with their score so operators
// can see what the store holds).
const MIN_SCORE = 0.5;

const KIND_LABEL = { decision: 'Decision', fact: 'Outcome', lesson: 'Lesson' };

const format = (m) => {
  const date = m.createdAt.toISOString().slice(0, 10);
  const label = KIND_LABEL[m.kind] ?? m.kind;
  return `[${date}] ${label}: ${m.content}`;
};

export default class MemoryService {
  repo = Container.get(AgentMemoryRepository);
  embeddings = Container.get(EmbeddingService);

  // Embed a memory's content best-effort. Returns embedding fields to spread into
  // a write, or {} when embeddings are unavailable.
  #embedFields = async (content) => {
    if (!this.embeddings.enabled) return {};
    const embedding = await this.embeddings.embed(content, 'document');
    return embedding ? { embedding, embeddingModel: this.embeddings.model } : {};
  };

  // Resolve where (and whether) a run's memory should be written, given the
  // configured write mode (see AgentConfig.memoryWrite). Returns the scope to
  // persist at, or null to skip the write entirely.
  #resolveWriteTarget = (run, writeMode) => {
    const lineId = run.scope?.lineId;
    if (!lineId) return null;
    const productId = run.scope?.productId ?? null;
    switch (writeMode) {
      case 'off':
        return null;
      case 'line':
        return { lineId, productId: null };
      case 'product':
        // No product on a line-level run → nowhere to write a product memory.
        return productId ? { lineId, productId } : null;
      case 'run':
      case 'auto':
      default:
        return { lineId, productId };
    }
  };

  // 'auto' write gate: a cheap LLM yes/no on whether an outcome is worth keeping.
  // Best-effort — on any failure we default to saving (never lose a memory to a
  // flaky gate, and never fail a run because of it).
  #shouldRecord = async (content) => {
    try {
      const { text } = await complete({
        system:
          'You decide whether a one-line agent outcome is worth remembering for ' +
          'future runs. Reply with only YES or NO. Answer NO for routine, no-op or ' +
          'trivial outcomes; YES for outcomes carrying a lesson, a notable decision, ' +
          'or a non-trivial result.',
        messages: [{ role: 'user', content }],
        maxTokens: 5,
      });
      return !/\bno\b/i.test(text);
    } catch {
      return true;
    }
  };

  // Base filenames from a list of file edits, capped. A recalled memory wants the
  // files that mattered, not full paths — `App.js, routes.js +2 more` reads better
  // and embeds more discriminatingly than a wall of `src/...` paths.
  #fileBasenames = (edits, max = 4) => {
    const names = (edits ?? []).map((e) => (e?.path ?? '').split('/').pop()).filter(Boolean);
    const shown = names.slice(0, max).join(', ');
    return names.length > max ? `${shown} +${names.length - max} more` : shown;
  };

  // A substantive one-liner describing what a proposal actually does — names the
  // files, change type and resolution shape so a recalled memory carries real
  // signal, not just the proposal title.
  #describeProposal = (proposal) => {
    const body = proposal.body ?? {};
    if (proposal.kind === 'merge_resolution') {
      const edits = body.fileEdits ?? [];
      const files = this.#fileBasenames(edits);
      // 'manual'/'exact' edits take a whole branch side verbatim; 'ai' edits are reconciled.
      const verbatim = edits.filter((e) => e.confidence === 'manual' || e.confidence === 'exact').length;
      const shape = edits.length
        ? ` (${edits.length} file(s)${verbatim ? `, ${verbatim} taken verbatim from one side` : ''})`
        : '';
      return `Sync resolution "${body.title ?? 'merge conflict'}"${files ? ` touching ${files}` : ''}${shape}`;
    }
    if (proposal.kind === 'fm_patch') {
      const files = this.#fileBasenames(body.fileEdits ?? []);
      const type = body.changeType ?? 'change';
      const feature = body.featureName ? ` feature "${body.featureName}"` : '';
      return `Harvest ${type}${feature}${files ? ` editing ${files}` : ''}`;
    }
    if (proposal.kind === 'git_comment') {
      return `Sync advisory "${body.title ?? 'resolution plan'}"`;
    }
    if (proposal.kind === 'plan_approval') {
      const cls = body.editClass ?? 'change';
      const stats = body.plan?.stats;
      const summary = stats
        ? `${stats.migrate ?? 0} migrate · ${stats.regen ?? 0} regen · ${stats.skip ?? 0} skip`
        : (body.title ?? 'family impact plan');
      return `Consolidation plan (${cls}): ${summary}`;
    }
    if (proposal.kind === 'test_review') {
      const sandbox = body.sandbox;
      const summary = sandbox?.summary ?? body.summary ?? 'test review';
      return `Consolidation test review: ${summary}`;
    }
    if (proposal.kind === 'deploy_approval') {
      const count = body.eligibleProducts?.length ?? 0;
      return `Consolidation deploy approval: ${count} product${count !== 1 ? 's' : ''} eligible`;
    }
    return `Proposal "${body.title ?? proposal.kind}" (${proposal.kind})`;
  };

  // Called after a human (or auto) decision on a proposal. Fire-and-forget safe.
  captureDecision = async ({ run, proposal, decision, writeMode = 'run' }) => {
    try {
      const target = this.#resolveWriteTarget(run, writeMode);
      if (!target) return;

      const decisionLabel = decision === 'approved' ? 'accepted' : decision === 'auto' ? 'auto-accepted' : 'rejected';
      const content = `${this.#describeProposal(proposal)} — ${decisionLabel}.`;

      if (writeMode === 'auto' && !(await this.#shouldRecord(content))) return;

      await this.repo.add({
        scope: target,
        agentType: run.agentType,
        kind: 'decision',
        content,
        sourceRunId: run._id,
        ...(await this.#embedFields(content)),
      });
    } catch {
      // Memory capture is best-effort — never fail a run because of it.
    }
  };

  // Called when a run reaches 'done'. Captures a lightweight outcome fact.
  captureRunOutcome = async ({ run, writeMode = 'run' }) => {
    try {
      const target = this.#resolveWriteTarget(run, writeMode);
      if (!target || !run.result) return;

      const result = run.result;
      let content;

      if (run.agentType === 'sync') {
        if (result.resolutionCommitted) {
          const files = this.#fileBasenames((result.filesCommitted ?? []).map((p) => ({ path: p })));
          const stage = result.stage ? ` (${result.stage} stage)` : '';
          content =
            `Sync resolution${stage} committed ${result.filesCommitted?.length ?? 0} file(s) to branch ${result.branch ?? 'source'}` +
            `${files ? `: ${files}` : ''}.`;
        } else if (result.commentPosted) {
          content = `Sync advisory comment posted on MR. Diagnosis: ${result.diagnosis?.title ?? 'conflict'}.`;
        } else {
          content = `Sync run completed with status: ${result.status ?? 'done'}.`;
        }
      } else if (run.agentType === 'harvest') {
        if (result.opened) {
          const type = result.changeType ? `${result.changeType} ` : '';
          content =
            `Harvest MR opened: ${type}for feature "${result.featureName ?? 'change'}". ` +
            `Files committed: ${result.filesCommitted?.length ?? 0}.`;
        } else if (result.advisory) {
          content = `Harvest produced advisory analysis for feature "${result.featureName ?? 'change'}".`;
        } else if (result.blocked) {
          content = `Harvest blocked: proposed FM change would break ${result.broken?.length ?? 0} product(s).`;
        } else {
          content = `Harvest run completed. Harvestable: ${result.harvestable}.`;
        }
      } else if (run.agentType === 'evolution') {
        content = `Evolution ${result.mode ?? 'migration'} run fixed ${result.fixed ?? 0} product spec(s).`;
      } else if (run.agentType === 'changeset') {
        const cascade = result.cascade;
        if (!cascade) return;
        const parts = [];
        if (cascade.migrate)    parts.push(`${cascade.migrate} migrated`);
        if (cascade.clean)      parts.push(`${cascade.clean} clean`);
        if (cascade.conflicted) parts.push(`${cascade.conflicted} conflict-resolved`);
        if (cascade.failed)     parts.push(`${cascade.failed} failed`);
        const cascadeSummary = parts.join(', ') || 'no cascade actions';
        const sandbox = result.sandbox;
        const sandboxNote =
          sandbox && !sandbox.skipped && sandbox.tested > 0
            ? ` Tests: ${sandbox.summary ?? `${sandbox.passed}/${sandbox.tested} passed`}.`
            : '';
        const autonomyNote = result.ledger?.memoryText
          ? '' // memoryText already carries autonomy info; skip duplicating
          : ` Autonomy: ${run.autonomyMode ?? 'semi'}.`;
        content =
          `ChangeSet ${result.editClass ?? ''} (${result.origin ?? 'manual'}): ${cascadeSummary}.${sandboxNote}${autonomyNote}`;
      } else {
        return; // Other agents don't produce meaningful outcome facts yet.
      }

      if (writeMode === 'auto' && !(await this.#shouldRecord(content))) return;

      await this.repo.add({
        scope: target,
        agentType: run.agentType,
        kind: 'fact',
        content,
        sourceRunId: run._id,
        ...(await this.#embedFields(content)),
      });
    } catch {
      // Best-effort.
    }
  };

  // Called when an operator triages a harvest candidate (dismiss / manually-harvested).
  // Persists a line-scoped `lesson` so the next harvest run — and the recall preview —
  // remember the operator already ruled on this kind of divergence, instead of the
  // miner re-surfacing it and the LLM re-evaluating it from scratch. Best-effort.
  // Returns the created memory's id (stored on the disposition so a restore can clean
  // it up), or null when nothing was written. `snoozed` is skipped — it's a "later",
  // not a lesson.
  captureDisposition = async ({ lineId, signature, state, reason, note, mrUrl, files, suggestedType }) => {
    try {
      if (!lineId) return null;
      if (state !== 'dismissed' && state !== 'manually-harvested') return null;

      const fileList = (files ?? []).map((p) => (p ?? '').split('/').pop()).filter(Boolean);
      const filesPhrase = fileList.length ? ` touching ${fileList.slice(0, 4).join(', ')}${fileList.length > 4 ? ` +${fileList.length - 4} more` : ''}` : '';
      const typePhrase = suggestedType ? ` (miner suggested ${suggestedType})` : '';
      const why = (reason ?? note ?? '').trim();

      const content =
        state === 'dismissed'
          ? `Operator dismissed a recurring divergence${filesPhrase}${typePhrase}` +
            `${why ? ` — reason: "${why}"` : ''}. Treat similar divergences as product-local; do not re-propose as a platform harvest.`
          : `Operator handled a recurring divergence${filesPhrase}${typePhrase} manually` +
            `${mrUrl ? ` (${mrUrl})` : ''}${why ? ` — note: "${why}"` : ''}. The platform may already carry this change; avoid re-proposing it.`;

      const created = await this.repo.add({
        scope: { lineId, productId: null },
        agentType: 'harvest',
        kind: 'lesson',
        content,
        sourceRunId: null,
        ...(await this.#embedFields(content)),
      });
      return created?._id ?? null;
    } catch {
      return null; // Best-effort — never fail the disposition write because of memory.
    }
  };

  // Load memories formatted as strings ready for LLM system-prompt injection.
  // Recency-only — the fallback when no query/embeddings are available.
  loadForScope = async ({ lineId, productId, agentType, readScope = 'product_line' }) => {
    if (!lineId) return [];
    const memories = await this.repo.findForRun({ lineId, productId, agentType, limit: MEMORY_LIMIT, readScope });
    return memories.map(format);
  };

  // Semantic retrieval: the top-K memories most relevant to `queryText`,
  // formatted for prompt injection. Falls back to recency when embeddings are
  // unavailable or the query can't be embedded — zero regression vs. loadForScope.
  // `readScope === 'none'` makes the agent stateless (no recall at all).
  retrieveRelevant = async ({ lineId, productId, agentType, queryText, k = RAG_K, readScope = 'product_line' }) => {
    if (!lineId || readScope === 'none') return [];
    if (!this.embeddings.enabled || !queryText?.trim()) {
      return this.loadForScope({ lineId, productId, agentType, readScope });
    }
    const queryVec = await this.embeddings.embed(queryText, 'query');
    if (!queryVec) return this.loadForScope({ lineId, productId, agentType, readScope });

    const ranked = await this.#rank({ lineId, productId, agentType, queryVec, k, minScore: MIN_SCORE, readScope });
    if (!ranked.length) return this.loadForScope({ lineId, productId, agentType, readScope });
    return ranked.map(({ memory }) => format(memory));
  };

  // Top-K relevant memories WITH similarity scores — powers the UI recall preview.
  // Returns plain objects: { _id, kind, agentType, content, createdAt, score }.
  searchRelevant = async ({ lineId, productId, agentType, queryText, k = RAG_K }) => {
    if (!lineId || !queryText?.trim()) return [];
    const queryVec = this.embeddings.enabled ? await this.embeddings.embed(queryText, 'query') : null;
    if (!queryVec) {
      // No embeddings: return recent memories with a null score so the UI can
      // still show "what would be recalled" (recency-only).
      const recent = await this.repo.findByScope({ lineId, productId, limit: k });
      return recent.map((m) => ({
        _id: m._id,
        kind: m.kind,
        agentType: m.agentType,
        content: m.content,
        createdAt: m.createdAt,
        score: null,
      }));
    }
    const ranked = await this.#rank({ lineId, productId, agentType, queryVec, k });
    return ranked.map(({ memory, score }) => ({
      _id: memory._id,
      kind: memory.kind,
      agentType: memory.agentType,
      content: memory.content,
      createdAt: memory.createdAt,
      score,
    }));
  };

  // Score the candidate pool against a query vector and return the top-K.
  // `minScore` drops low-relevance matches (used for run injection); pass 0 to keep
  // every scored candidate (used for the diagnostic UI recall preview).
  #rank = async ({ lineId, productId, agentType, queryVec, k, minScore = 0, readScope = 'product_line' }) => {
    const candidates = await this.repo.findCandidates({
      lineId,
      productId,
      agentType,
      limit: CANDIDATE_POOL,
      readScope,
    });
    return candidates
      .filter((m) => m.embedding?.length)
      .map((memory) => ({ memory, score: cosineSimilarity(queryVec, memory.embedding) }))
      .filter(({ score }) => score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  };

  // List raw memory documents for a scope (used by REST/UI).
  listForScope = async ({ lineId, productId, limit }) =>
    this.repo.findByScope({ lineId, productId: productId || null, limit: limit || 50 });

  // Manually add a memory entry authored by a human (kind defaults to 'lesson').
  addManual = async ({ lineId, productId, kind = 'lesson', content, userId }) => {
    if (!lineId || !content?.trim()) throw new Error('lineId and content are required');
    const text = content.trim();
    return this.repo.add({
      scope: { lineId, productId: productId ?? null },
      agentType: 'manual',
      kind,
      content: text,
      sourceRunId: null,
      ...(await this.#embedFields(text)),
    });
  };

  deleteById = async (id) => this.repo.deleteById(id);

  clearScope = async ({ lineId, productId }) =>
    this.repo.deleteByScope({ lineId, productId: productId || null });
}

Container.set(MemoryService, new MemoryService());
