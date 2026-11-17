import { Container } from 'typedi';
import { runToolLoop } from '../core/llm.js';
import { listPlatformFiles, readRepoFile, readLineModel, validateModelAgainstProducts } from '../tools/harvest.js';
import { lineAccess } from '../tools/git.js';
import { getAnthropicApiKey } from '../../model/connectors/properties.js';
import { createBranch as createBranchRest, commit as commitFiles, isBranchAlreadyExistsError } from '../../linea/repo.js';
import LineService from '../../model/services/LineService.js';
import MemoryService from '../memory/MemoryService.js';

/**
 * Deterministic fallback proposal produced when ANTHROPIC_API_KEY is not set.
 * Returns a plausible-shaped proposal so the sandbox flow is exercisable end
 * to end without a real LLM — the user is expected to edit the mock file (and
 * the FM) inside the Sandbox tab before merging.
 */
const buildMockProposal = ({ intent, modelInfo, priorProposal, feedback }) => {
  const slug = String(intent ?? 'change').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 40) || 'change';
  const timestamp = new Date().toISOString();
  const revision = priorProposal ? '\n\n---\n_Refinement:_ ' + (feedback ?? '(no feedback)') : '';

  const mockFilePath = `src/platform/mock-${slug}.md`;
  const mockFileContent =
    `# Mock proposal — ${slug}\n\n` +
    `> Generated without an LLM because \`ANTHROPIC_API_KEY\` is not set on the ` +
    `server. Iterate on this file (and the feature model) inside the Sandbox tab, ` +
    `commit each iteration, and approve when ready.\n\n` +
    `**Requested intent:** ${intent}\n\n` +
    `**Generated at:** ${timestamp}\n${revision}\n`;

  return {
    proposal: {
      intent: `Mock: ${intent}`,
      reasoning:
        `Mock proposal — ANTHROPIC_API_KEY is not set on the server, so the ` +
        `LLM was bypassed. A placeholder file was scaffolded under src/platform/ ` +
        `so you can exercise the commit + sandbox flow end to end. The feature ` +
        `model is unchanged; edit either side in the Sandbox tab before merging.`,
      newModelUvl: '',
      fileEdits: [{
        path: mockFilePath,
        action: 'create',
        newContent: mockFileContent,
        oldContent: '',
        rationale: 'Mock scaffold (no LLM).',
      }],
    },
    llmText: null,
  };
};

/**
 * Short-lived in-memory sessions for the "Propose with AI" change-set flow.
 *
 * A session is created when the user types their intent (startSession), can be
 * refined any number of times via the chat (refineSession), and ends when the
 * approved proposal is committed to a plan/ branch (commitSession).
 *
 * Sessions expire after 30 minutes; no MongoDB storage is needed since the
 * user works through the dialog in one sitting.
 */

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map();

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const pruneExpired = () => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
};

// ── Tool definitions ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert Software Product Line (SPL) platform engineer.
The user wants to evolve the SPL — they have a change in mind and your job is to propose concrete, well-grounded modifications to the feature model and/or the platform code.

The feature model (FM) defines the set of valid product configurations in Universal Variability Language (UVL). The platform code lives under src/platform/ and is the generator-owned template code tailored per product by feature selection.

Process:
1. Read the current FM from the context already provided.
2. Use list_spl_files to see the platform templates/helpers under src/platform/.
3. Use read_spl_file to read every file you intend to change.
4. Call propose_spl_change with the concrete changes.

FM rules (only when changing the feature model):
- Return the FULL updated UVL — never truncate. Preserve all existing features unless the user explicitly asked to remove/rename them.
- New optional features default to off. Mandatory features must be justified (they affect every product).
- Gate any new platform code behind the same conditional mechanism existing features use.

Platform file rules:
- Return COMPLETE file content for each edit — no abbreviation or placeholder comments.
- Keep edits minimal and consistent with the existing style.
- Only edit files you have read first.

If the user's request is vague, make reasonable assumptions and explain them in reasoning.`;

const LIST_TOOL = {
  name: 'list_spl_files',
  description: 'List platform template/helper files (blobs under src/platform) in the line repo.',
  input_schema: { type: 'object', properties: {} },
};

const READ_TOOL = {
  name: 'read_spl_file',
  description: 'Read the current content of a file under src/ in the line repo.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Repo path, e.g. src/platform/template.js' } },
    required: ['path'],
  },
};

const PROPOSE_TOOL = {
  name: 'propose_spl_change',
  description: 'Propose a well-grounded, compiling change to the SPL feature model and/or platform files.',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        description: 'One-line description of the change.',
      },
      newModelUvl: {
        type: 'string',
        description: 'FULL updated UVL model. Include only if the FM changes; leave empty otherwise.',
      },
      fileEdits: {
        type: 'array',
        description: 'Platform file edits. Provide COMPLETE new content for each changed file.',
        items: {
          type: 'object',
          properties: {
            path:       { type: 'string' },
            action:     { type: 'string', enum: ['create', 'update'] },
            newContent: { type: 'string' },
            rationale:  { type: 'string' },
          },
          required: ['path', 'newContent'],
        },
      },
      reasoning: {
        type: 'string',
        description: 'Explain what changed, why, and any assumptions made.',
      },
    },
    required: ['intent', 'reasoning'],
  },
};

// Compact the prior proposal before re-seeding it. On iteration the LLM only
// needs to remember *what* it proposed (path/action/rationale), not the full
// contents of every edit — those blow up the prompt on every turn and are the
// #1 driver of runaway token spend on long chats. Big `newContent` bodies are
// replaced with a stub; the LLM can re-fetch via `read_spl_file` if it
// really needs to inspect the previous edit.
const MAX_INLINE_CONTENT = 800;

const compactContent = (s) => {
  if (typeof s !== 'string') return s;
  return s.length <= MAX_INLINE_CONTENT
    ? s
    : `${s.slice(0, MAX_INLINE_CONTENT)}\n\n… [content truncated — call read_spl_file "{path}" to inspect]`;
};

const proposalToInput = (proposal) => ({
  intent:      proposal.intent,
  newModelUvl: proposal.newModelUvl,      // FM stays intact; needed for revision continuity.
  reasoning:   compactContent(proposal.reasoning),
  fileEdits: (proposal.fileEdits ?? []).map((e) => ({
    path:       e.path,
    action:     e.action,
    rationale:  e.rationale,
    newContent: compactContent(e.newContent),
  })),
});

const buildMessages = ({ intent, modelInfo, priorProposal = null, feedback = null }) => {
  const userContent =
    `## User request\n${intent}\n\n` +
    `## Current feature model (${modelInfo.type})\n\`\`\`\n${modelInfo.content}\n\`\`\`\n\n` +
    `Inspect the platform files (list/read tools) and call propose_spl_change with concrete changes.`;

  const messages = [{ role: 'user', content: userContent }];

  if (priorProposal && feedback) {
    // Re-seed the conversation with the prior proposal + new feedback, matching the
    // harvest refine pattern (proposeHarvest.js:290).
    messages.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'prior_proposal', name: 'propose_spl_change', input: priorProposal }],
    });
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'prior_proposal', content: 'Recorded. The user reviewed it and has feedback.' },
        { type: 'text', text: `Revise the proposal based on this feedback. Re-read any files you need first.\n\nFeedback: ${feedback}` },
      ],
    });
  }

  return messages;
};

const runProposal = async ({ lineProjectId, modelInfo, intent, priorProposal = null, feedback = null, memories = [] }) => {
  // Short-circuit when no LLM is configured — return a deterministic mock so the
  // sandbox flow (branch, commit, iterate, playground, merge) stays testable.
  if (!getAnthropicApiKey()) {
    return buildMockProposal({ intent, modelInfo, priorProposal, feedback });
  }

  try {
    return await runProposalWithLlm({ lineProjectId, modelInfo, intent, priorProposal, feedback, memories });
  } catch (err) {
    console.warn(`[changeset-proposal] LLM call failed, falling back to mock: ${err?.message ?? err}`);
    const mock = buildMockProposal({ intent, modelInfo, priorProposal, feedback });
    mock.llmText = `The LLM call failed (${err?.status ?? '?'}: ${err?.message ?? err}). A mock proposal was generated instead so you can keep iterating.`;
    return mock;
  }
};

const runProposalWithLlm = async ({ lineProjectId, modelInfo, intent, priorProposal = null, feedback = null, memories = [] }) => {
  let proposal = null;
  const readCache = {};

  const executeTool = async (name, input) => {
    if (name === 'propose_spl_change') {
      proposal = input;
      return 'Proposal received.';
    }
    if (name === 'list_spl_files') {
      try {
        return { files: await listPlatformFiles({ lineProjectId }) };
      } catch (e) {
        return `Could not list platform files: ${e?.message ?? e}`;
      }
    }
    if (name === 'read_spl_file') {
      const p = input?.path ?? '';
      if (!p.startsWith('src/')) return 'Only paths under src/ may be read.';
      try {
        const content = await readRepoFile({ lineProjectId, path: p });
        readCache[p] = content;
        return { path: p, content };
      } catch (e) {
        return `Could not read ${p}: ${e?.message ?? e}`;
      }
    }
    return `Unknown tool: ${name}`;
  };

  const messages = buildMessages({ intent, modelInfo, priorProposal, feedback });

  const { text: llmText } = await runToolLoop({
    system: SYSTEM_PROMPT,
    tools: [LIST_TOOL, READ_TOOL, PROPOSE_TOOL],
    executeTool,
    // 6 rounds is enough for a well-scoped change: list files, read 2–3,
    // propose. Fewer rounds → less prompt bloat from tool_results piling up.
    maxTurns: 6,
    maxTokens: 8192,
    messages,
    memories,
  });

  if (!proposal) {
    return { proposal: null, llmText: llmText || 'I could not generate a concrete proposal from that description.' };
  }

  // Attach oldContent so the frontend can render diffs.
  for (const e of proposal.fileEdits ?? []) {
    if (e.action === 'create') { e.oldContent = ''; continue; }
    e.oldContent = readCache[e.path] ?? null;
    if (e.oldContent == null) {
      try { e.oldContent = await readRepoFile({ lineProjectId, path: e.path }); }
      catch { e.oldContent = ''; }
    }
  }

  return { proposal, llmText: null };
};

const validateProposal = async ({ proposal, modelInfo, products }) => {
  if (!proposal?.newModelUvl || modelInfo.type !== 'UVL') return { validated: false };
  try {
    const { valid, broken } = validateModelAgainstProducts({
      modelContent: proposal.newModelUvl,
      type: 'UVL',
      products,
    });
    return { validated: true, valid, broken, checked: products.length };
  } catch (err) {
    return { validated: true, valid: false, broken: [], parseError: err?.message ?? String(err) };
  }
};

export const createPlanBranch = async ({ lineProjectId, modelInfo, proposal }) => {
  const safeName = (proposal.intent ?? 'change').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
  const branch = `plan/ai-${safeName}-${Date.now()}`;

  const actions = [];
  if (proposal.newModelUvl && modelInfo?.path) {
    actions.push({ action: 'update', path: modelInfo.path, content: proposal.newModelUvl });
  }
  for (const edit of proposal.fileEdits ?? []) {
    if (!edit?.path || edit.newContent == null) continue;
    actions.push({
      action: edit.action === 'create' ? 'create' : 'update',
      path: edit.path,
      content: edit.newContent,
    });
  }
  if (actions.length === 0) throw new Error('No changes to commit.');

  try {
    await createBranchRest({ id: lineProjectId, branch, ref: 'main' });
  } catch (err) {
    if (!isBranchAlreadyExistsError(err)) throw err;
  }

  await commitFiles({
    id: lineProjectId,
    branch,
    message: `Plan: ${proposal.intent ?? 'AI-proposed SPL change'}`,
    actions,
  });

  return branch;
};

// ── Public API ────────────────────────────────────────────────────────────────

export const startSession = async ({ lineId, userId, intent }) => {
  pruneExpired();

  const { lineProjectId } = await lineAccess({ lineId, userId});
  const modelInfo  = await readLineModel({ lineProjectId, lineId, userId });
  const products   = await Container.get(LineService).findProductsByLineId({ id: lineId, userId, specFromRepo: true });

  let memories = [];
  try {
    memories = await Container.get(MemoryService).retrieveRelevant({
      lineId, productId: null, agentType: 'changeset', queryText: intent,
    });
  } catch { /* best-effort */ }

  const { proposal, llmText } = await runProposal({ lineProjectId, modelInfo, intent, memories });
  const validation = await validateProposal({ proposal, modelInfo, products });

  const sessionId = makeId();
  sessions.set(sessionId, {
    userId, lineProjectId, modelInfo, products,
    intent, proposal, validation,
    createdAt: Date.now(),
  });

  return { sessionId, proposal, llmText, validation, modelInfo };
};

/**
 * Stateless proposal turn: build a proposal (or refine an existing one) without
 * relying on the in-memory sessions map. Used by the persistent per-version
 * chat, where the "session" lives in Mongo (VersionChatMessage) — the caller
 * passes the last assistant proposal as `priorProposal` so the LLM can iterate
 * on it. Same LLM tool loop as startSession, no session bookkeeping.
 */
export const turnFromHistory = async ({ lineId, userId, intent, priorProposal = null }) => {
  const { lineProjectId } = await lineAccess({ lineId, userId});
  const modelInfo  = await readLineModel({ lineProjectId, lineId, userId });
  const products   = await Container.get(LineService).findProductsByLineId({ id: lineId, userId, specFromRepo: true });

  let memories = [];
  try {
    memories = await Container.get(MemoryService).retrieveRelevant({
      lineId, productId: null, agentType: 'changeset', queryText: intent,
    });
  } catch { /* best-effort */ }

  const { proposal, llmText } = await runProposal({
    lineProjectId, modelInfo, intent, memories,
    priorProposal: priorProposal ? proposalToInput(priorProposal) : null,
    feedback: priorProposal ? intent : null,
  });
  const validation = await validateProposal({ proposal, modelInfo, products });

  return { proposal, llmText, validation, modelInfo };
};

export const refineSession = async ({ sessionId, userId, message }) => {
  pruneExpired();
  const s = sessions.get(sessionId);
  if (!s) throw new Error('Session not found or expired.');
  if (String(s.userId) !== String(userId)) throw new Error('Unauthorized.');

  const { proposal, llmText } = await runProposal({
    lineProjectId: s.lineProjectId,
    modelInfo: s.modelInfo,
    intent: s.intent,
    priorProposal: s.proposal ? proposalToInput(s.proposal) : null,
    feedback: message,
  });
  const validation = await validateProposal({ proposal, modelInfo: s.modelInfo, products: s.products });

  s.proposal   = proposal;
  s.validation = validation;

  return { proposal, llmText, validation };
};

export const commitSession = async ({ sessionId, userId }) => {
  pruneExpired();
  const s = sessions.get(sessionId);
  if (!s) throw new Error('Session not found or expired.');
  if (String(s.userId) !== String(userId)) throw new Error('Unauthorized.');
  if (!s.proposal) throw new Error('No proposal to commit.');

  const branch = await createPlanBranch({
    lineProjectId: s.lineProjectId,
    modelInfo: s.modelInfo,
    proposal: s.proposal,
  });

  sessions.delete(sessionId);
  return { branch };
};
