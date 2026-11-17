import { Container } from 'typedi';
import LogRepository from '../../model/repositories/LogRepository.js';
import { branches } from './git.js';
import * as repo from '../../linea/repo.js';

/**
 * Sync agent tools. Two concerns, one module (both are used only by the Sync
 * agent + SyncResolveService):
 *
 *  1. DIAGNOSIS — the deterministic core that reads the generation log trail and
 *     classifies the outcome / conflict from the i18n key of the last error.
 *  2. AUTO-RESOLVE — reading/committing reconciled files onto the MR source
 *     branch (bigbang) and re-checking mergeability.
 *
 * See docs/mcp/ideas/automatic-workflows-grounded.md, Workflow A.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Diagnosis
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The thrown HTTP error from generateProduct is almost useless; the truth is the
 * i18n key of the last error/warning `Log` entry. The key *is* the classification
 * — no model needed.
 */
const DIAGNOSES = {
  error_downloading_spl: {
    title: 'SPL repository unreachable',
    action: 'Check the line repository access / git host health, then retry.',
    severity: 'error',
  },
  error_downloading_product: {
    title: 'Product bigbang branch missing',
    action: 'The product repo may be corrupt; re-create bigbang from main.',
    severity: 'error',
  },
  missing_function_error: {
    title: 'Platform template bug (ReferenceError)',
    action:
      'A platform template / extra.js / transformation.js calls an undefined function. This is a platform-authoring bug — route to the domain engineer (Platform Doctor).',
    severity: 'error',
  },
  error_empty_code: {
    title: 'Already up to date',
    action: 'No changes to regenerate — the product matches the current generation. No action needed.',
    severity: 'info',
  },
  error_creating_branch: {
    title: 'Git host write failure (branch creation)',
    action: 'A stale generation/<v> branch may exist; delete it and retry.',
    severity: 'error',
  },
  error_committing_generation: {
    title: 'Git host write failure (commit)',
    action: 'A stale generation/<v> branch may exist; delete it and retry.',
    severity: 'error',
  },
  error_merging: {
    title: 'Merge failed',
    action: 'The merge request could not be merged automatically; inspect it on the git host.',
    severity: 'error',
  },
  conflicts_merge_request: {
    title: 'Merge conflict',
    action: 'Review the per-file resolution plan below.',
    severity: 'warning',
  },
};

const keyOf = (entry) => entry?.message?.split('.').pop() ?? null;

export const readProductLogs = async ({ productId, version }) =>
  Container.get(LogRepository).findByProductIdAndVersionOrderByCreatedAtAsc(productId, version);

/**
 * Classify the outcome of the latest generation from its log trail.
 * Returns one of:
 *   { status: 'ok' }                                 last sync succeeded
 *   { status: 'unknown', reason }                    no logs / nothing classifiable
 *   { status: 'issue', key, stage, mrUrl, diagnosis, params }
 */
export const classifyLogs = (logs) => {
  if (!logs || logs.length === 0) {
    return { status: 'unknown', reason: 'No generation logs for this version.' };
  }

  const last = logs[logs.length - 1];
  if (last.type === 'success') {
    return { status: 'ok', key: keyOf(last) };
  }

  const issue = [...logs].reverse().find((l) => l.type === 'error' || l.type === 'warning');
  if (!issue) return { status: 'unknown', reason: 'No error or warning in the log trail.' };

  const key = keyOf(issue);
  const diagnosis = DIAGNOSES[key] ?? {
    title: key ?? 'Unknown failure',
    action: 'Inspect the generation logs.',
    severity: issue.type,
  };

  // Decode which merge stage conflicted from the logged [source, target] branches.
  let stage = null;
  if (key === 'conflicts_merge_request' || key === 'error_merging') {
    const target = issue.params?.[1];
    stage = target === branches.base ? 'generating' : target === branches.default ? 'update' : null;
  }

  return {
    status: 'issue',
    key,
    stage,
    mrUrl: issue.link ?? null,
    diagnosis,
    params: issue.params ?? [],
  };
};

// Files the generator never owns — they may carry hand-made edits, so a conflict
// touching one is NOT safe to auto-resolve.
const KNOWN_CUSTOMIZATION = [
  /^README\.md$/i,
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)\.gitignore$/,
  /(^|\/)docker-compose\.ya?ml$/,
  /(^|\/)\.gitlab-ci\.ya?ml$/,
];

const isCustomization = (filePath) => KNOWN_CUSTOMIZATION.some((re) => re.test(filePath));

const isLineaMetadata = (filePath) => filePath?.startsWith('.linea/');

/**
 * Deterministic resolvability classification of the conflicting files.
 * - generator-owned file → 'theirs' (take the generated version)
 * - known customization point → 'ours' (keep the current version, may hold edits)
 * - `.linea/**` metadata → excluded entirely (ADR-033)
 *
 * `unambiguous` is true only when EVERY conflicting file is generator-owned — the
 * one case safe to auto-resolve without re-running generation. Any customization
 * conflict downgrades the whole run to propose-and-wait. (See plan §6, rule 2.)
 */
export const classifyFiles = (files) => {
  const classified = (files ?? [])
    .filter((f) => !isLineaMetadata(f.path))
    .map((f) => {
      const ours = isCustomization(f.path);
      return {
        path: f.path,
        resolution: ours ? 'ours' : 'theirs',
        reason: ours
          ? 'Known customization point — keep the current version.'
          : 'Generator-owned file — take the generated version.',
      };
    });
  const unambiguous = classified.length > 0 && classified.every((c) => c.resolution === 'theirs');
  return { files: classified, unambiguous };
};

/**
 * Fetch the conflicting merge request + its changed files for a stage.
 * `generating` targets bigbang; `update` targets main.
 */
export const fetchConflict = async ({ userId, projectId, stage }) => {
  const targetBranch = stage === 'update' ? branches.default : branches.base;
  const mrs = await repo.listMergeRequests({ id: projectId, userId, state: 'opened', targetBranch });
  // (a host's list does not always compute conflicts: each MR is asked for in full)
  const full = await Promise.all(mrs.map((m) => repo.getMergeRequest({ id: projectId, userId, number: m.number }).catch(() => m)));
  const mr = full.find((m) => m.hasConflicts) ?? full[0];
  if (!mr) return { mr: null, files: [] };

  const changes = await repo.getMergeRequestChanges({ id: projectId, userId, number: mr.number });
  const files = (changes ?? []).map((c) => ({
    path: c.newPath,
    added: c.status === 'added',
    deleted: c.status === 'deleted',
    renamed: c.status === 'renamed',
    diff: c.patch,
  }));

  return {
    mr: {
      iid: mr.number,
      title: mr.title,
      webUrl: mr.webUrl,
      sourceBranch: mr.sourceBranch,
      targetBranch: mr.targetBranch,
      hasConflicts: Boolean(mr.hasConflicts),
    },
    files,
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// Auto-resolve (bigbang → main, stage 'update')
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The conflict exists because `main` was edited directly, outside the generation
 * flow, so the generated `bigbang` baseline no longer merges cleanly. Resolving
 * means producing a reconciled version of each conflicting file (generated
 * behaviour + the manual customization), then committing it onto the MR's source
 * branch (`bigbang`) so the MR can merge.
 *
 * The writes here are NOT runtime-tested against every git host; the MR is the
 * human review gate and nothing is ever auto-merged.
 */

/** Read a file from the product repo at a specific branch/ref. Returns '' if absent. */
export const readFileAtRef = async ({ userId, projectId, path, ref }) =>
  // a file that is not there is '' (it is new on the other side); any other failure is not an absent file
  (await repo.readFile({ id: projectId, userId, path, ref })) ?? '';

/**
 * Commit the reconciled file contents onto a branch (the MR's source branch,
 * `bigbang`). Each edit carries its COMPLETE new content.
 */
export const commitResolution = async ({ userId, projectId, branch, edits, message }) => {
  const actions = (edits ?? [])
    .filter((e) => e?.path && e.newContent != null)
    .map((e) => ({
      action: e.action === 'create' ? 'create' : e.action === 'delete' ? 'delete' : 'update',
      path: e.path,
      content: e.action === 'delete' ? undefined : e.newContent,
    }));
  if (actions.length === 0) throw new Error('Resolution has no file changes to commit.');

  const made = await repo.commit({ id: projectId, userId, branch, message, actions });
  return { committed: actions.length, commitId: made?.id ?? null };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Re-check whether the conflicting MR still reports conflicts after a resolution
 * commit. A git host recomputes mergeability asynchronously, so while the MR still
 * reports conflicts we poll a few times before giving up, and then return the
 * final result.
 */
export const recheckMergeability = async ({ userId, projectId, mrIid, maxRetries = 4, delayMs = 3000 }) => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    const listed = await repo.listMergeRequests({ id: projectId, userId, state: 'opened', targetBranch: branches.default });
    if (!listed.some((m) => m.number === mrIid)) return { found: false, hasConflicts: null };
    const mr = await repo.getMergeRequest({ id: projectId, userId, number: mrIid });
    // The host may not have finished computing yet — keep waiting while it still says conflicts.
    if (mr.hasConflicts && attempt < maxRetries) continue;
    return { found: true, hasConflicts: Boolean(mr.hasConflicts), webUrl: mr.webUrl };
  }
};
