import { runToolLoop } from '../core/llm.js';
import { branches } from '../tools/git.js';
import { readFileAtRef } from '../tools/sync.js';

/**
 * Shared Sync auto-resolve machinery, used by both the Sync agent's
 * `resolve-edits` step and the `/refine` endpoint (chat-to-revise). The tool loop
 * lets Claude read the real conflicting files from BOTH branches (the generated
 * `bigbang` source and the directly-edited `main` target) and return concrete,
 * reconciled file contents.
 */

const MAX_FILES = 20;
const MAX_DIFF_CHARS = 4000;

const SYSTEM_PROMPT = `You are an expert Software Product Line (SPL) merge-conflict resolver.

A product's generated baseline branch ('bigbang') cannot merge into its working branch ('main') because someone edited 'main' directly, outside the generation flow. You must resolve each conflicting file by producing a SINGLE reconciled version that keeps BOTH:
- the generated behaviour from 'bigbang' (the source branch — the up-to-date generated code), and
- the legitimate manual customization from 'main' (the target branch).

How to work:
1. For every conflicting file, use read_file to read its content on BOTH branches ('bigbang' and 'main') before deciding. Do not guess — read first.
2. Produce the COMPLETE merged content for each file:
   - Generator-owned regions → take the 'bigbang' (generated) version.
   - Genuine manual customizations on 'main' (config, env, hand-written sections) → preserve them on top of the generated content.
   - When in doubt, prefer keeping the manual customization and layering the generated change around it; explain the choice in the rationale.
3. Never invent files that are not in the conflicting set.

Always call propose_resolution. The merged content you return will be committed onto the 'bigbang' source branch so the merge request can merge cleanly. A human reviews every diff before anything is committed.`;

const READ_TOOL = {
  name: 'read_file',
  description:
    "Read a conflicting file's full content on a given branch. Use branch 'bigbang' (generated source) or 'main' (directly-edited target).",
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repo path of a conflicting file.' },
      branch: { type: 'string', enum: ['bigbang', 'main'], description: 'Which branch to read from.' },
    },
    required: ['path', 'branch'],
  },
};

const PROPOSE_TOOL = {
  name: 'propose_resolution',
  description: 'Propose the reconciled content for each conflicting file, to be committed onto the bigbang source branch.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Short markdown overview of how the conflict was resolved.' },
      resolveEdits: {
        type: 'array',
        description: 'One entry per conflicting file, each with the COMPLETE reconciled content.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            action: { type: 'string', enum: ['update', 'create', 'delete'] },
            newContent: { type: 'string', description: 'Full reconciled file content (omit for action delete).' },
            rationale: { type: 'string', description: 'How this file was reconciled and why.' },
          },
          required: ['path', 'rationale'],
        },
      },
    },
    required: ['summary', 'resolveEdits'],
  },
};

const buildUserMessage = ({ productName, features, diagnosis, files }) => {
  const fileBlocks = (files ?? [])
    .slice(0, MAX_FILES)
    .map((f) => {
      const tags = [f.added && 'added', f.deleted && 'deleted', f.renamed && 'renamed'].filter(Boolean).join(', ');
      return `### ${f.path}${tags ? ` (${tags})` : ''}\n\`\`\`diff\n${(f.diff ?? '').slice(0, MAX_DIFF_CHARS)}\n\`\`\``;
    })
    .join('\n\n');

  return (
    `## Product: ${productName}\n` +
    `Feature selection: ${features?.length ? features.join(', ') : '(none)'}\n\n` +
    `## Conflict: bigbang → main (the generated baseline cannot merge into the directly-edited main)\n` +
    (diagnosis ? `Diagnosis: ${diagnosis.title} — ${diagnosis.action}\n\n` : '\n') +
    `## Conflicting files (${(files ?? []).length})\n${fileBlocks || '_No file diffs available._'}\n\n` +
    `Read each file on both branches, then call propose_resolution with the merged content per file.`
  );
};

export const buildResolutionMarkdown = ({ plan, recheck, testResult = null }) => {
  const editsSection = plan.resolveEdits?.length
    ? `## Reconciled files (committed onto \`bigbang\`)\n${plan.resolveEdits
        .map((e) => `- \`${e.path}\` (${e.action ?? 'update'})${e.rationale ? ` — ${e.rationale}` : ''}`)
        .join('\n')}\n\n`
    : '';
  const recheckLine =
    recheck == null
      ? ''
      : recheck.hasConflicts === false
      ? '✅ After the resolution commit, the merge request reports no conflicts.\n\n'
      : recheck.hasConflicts === true
      ? '⏳ The git host is still recomputing mergeability (the MR may briefly still show conflicts).\n\n'
      : '';
  const testLine =
    testResult == null
      ? ''
      : testResult.passed
      ? `✅ Automated test run passed after ${testResult.attempts} attempt(s).\n\n`
      : `⚠️ Tests did not pass after ${testResult.attempts} attempt(s) — review carefully before applying.\n\n`;

  return `## How the conflict was resolved\n${plan.summary ?? ''}\n\n` + testLine + editsSection + recheckLine;
};

// Raw propose_resolution input (without the diff helper fields), for re-seeding refine.
export const planToToolInput = (plan) => ({
  summary: plan.summary,
  resolveEdits: (plan.resolveEdits ?? []).map((e) => ({
    path: e.path,
    action: e.action,
    newContent: e.newContent,
    rationale: e.rationale,
  })),
});

/**
 * Run the resolution tool loop. `prior` (optional) re-seeds the conversation with
 * the previous proposal + the user's feedback, so the model revises it in place.
 * `fileResolution` is the deterministic per-file classification from classifyFiles()
 * ({ path, resolution: 'theirs'|'ours' }[]); files with a clear owner get their
 * content replaced with exact branch bytes after the LLM pass so the 3-way merge
 * on the git host sees identical content on both sides and reports no conflict.
 * Returns the raw plan (propose_resolution input) with `oldContent` (the current
 * `main` version) attached per file for the diff view.
 */
export const runSyncResolution = async ({ projectId, detect, fileResolution = [], prior = null, memories = [], instructions = '', loopRunner = runToolLoop }) => {
  let proposal = null;
  const readCache = {}; // `${branch}:${path}` -> content

  const executeTool = async (name, input) => {
    if (name === 'propose_resolution') {
      proposal = input;
      return 'Resolution received.';
    }
    if (name === 'read_file') {
      const path = input?.path ?? '';
      const branch = input?.branch === 'main' ? branches.default : branches.base;
      const key = `${branch}:${path}`;
      if (readCache[key] == null) {
        readCache[key] = await readFileAtRef({ projectId, path, ref: branch });
      }
      return { path, branch: input?.branch, content: readCache[key] };
    }
    return `Unknown tool: ${name}`;
  };

  const messages = [
    {
      role: 'user',
      content: buildUserMessage({
        productName: detect.productName,
        features: detect.features,
        diagnosis: detect.diagnosis,
        files: detect.files,
      }),
    },
  ];

  if (prior) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'prior_resolution', name: 'propose_resolution', input: prior.input }] });
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'prior_resolution', content: 'Recorded. The user reviewed it and has feedback.' },
        { type: 'text', text: `Revise the resolution based on this feedback. Re-read any files you need first.\n\nFeedback: ${prior.feedback}` },
      ],
    });
  }

  // `loopRunner` defaults to the in-memory runToolLoop (used by the human-gated refine
  // path); the sync agent step passes ctx.runToolLoop for durable, checkpointed turns.
  await loopRunner({ system: SYSTEM_PROMPT, tools: [READ_TOOL, PROPOSE_TOOL], executeTool, maxTurns: 14, maxTokens: 8192, messages, memories, instructions });

  if (!proposal) return null;

  // Build a fast-lookup map from the deterministic classification.
  const classMap = Object.fromEntries((fileResolution ?? []).map((f) => [f.path, f.resolution]));

  for (const e of proposal.resolveEdits ?? []) {
    const mainKey = `${branches.default}:${e.path}`;
    const bigbangKey = `${branches.base}:${e.path}`;

    // A "generator-owned" ('theirs') classification used to force bigbang's exact
    // bytes here, discarding whatever the LLM proposed, on the assumption that a
    // non-customization file never carries product-side edits. That assumption is
    // false in practice: main legitimately accumulates manual changes in ordinary
    // source files (e.g. hand-added enum values), not just the customization
    // allowlist below — and the override was silently dropping that work while
    // labeling it 'exact' (implying safe/verified) and while the LLM's own
    // rationale text claimed a merge that never actually happened. Only 'ours'
    // (a known customization point) still gets a deterministic override, since
    // declining to touch it can't lose anything — it just keeps main unchanged.
    if (e.action !== 'delete') {
      const cls = classMap[e.path];
      if (cls === 'ours') {
        // Customization point → keep main verbatim (no change from target's view).
        e.newContent =
          readCache[mainKey] ??
          (await readFileAtRef({ projectId, path: e.path, ref: branches.default }));
        e.confidence = 'exact';
      } else {
        // 'theirs' or unclassified: trust the LLM's actual reconciliation and flag
        // it for human review — there's no deterministic guarantee it preserved
        // everything on both sides.
        e.confidence = 'ai';
      }
    }

    // Attach the current `main` (target) content as `oldContent` so the review diff
    // shows the engineer how their working branch will change.
    e.oldContent =
      readCache[mainKey] ??
      (await readFileAtRef({ projectId, path: e.path, ref: branches.default }));

    // Also attach the generated `bigbang` (source) content as `theirsContent` so the
    // review can offer a three-way view (ours = main, theirs = bigbang, proposed =
    // reconciled). We use the two real branch sides rather than the git merge-base —
    // for an update-stage conflict those two are exactly what the operator reconciles.
    if (e.action !== 'delete') {
      e.theirsContent =
        readCache[bigbangKey] ??
        (await readFileAtRef({ projectId, path: e.path, ref: branches.base }));
    }
  }

  return proposal;
};
