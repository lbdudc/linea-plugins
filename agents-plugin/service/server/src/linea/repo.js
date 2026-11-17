import { linea } from './LineaClient.js';

/**
 * The code of a repository, through LINEA. Agents does not know which git host is behind: LINEA reads and writes the repositories of
 * its lines and products as the person agents acts for (their access is what limits a call), and answers in the same words for every host.
 *
 * A repository is its `id` on the host (what LINEA calls `repo.id` of a product, `repoId` of a line). `host` is only needed when the
 * deployment has more than one and it is not the primary.
 */

const base = ({ id }) => `/api/repos/${encodeURIComponent(id)}`;
const q = ({ host }, extra = {}) => ({ host, ...extra });
const opts = ({ userId }) => (userId === undefined ? {} : { userId });

/** The names of the branches. */
export const listBranches = (repo) => linea.get(`${base(repo)}/branches`, { ...opts(repo), query: q(repo) });

/** `{ name, lastCommit }` of `branch`. */
export const getBranch = (repo) => linea.get(`${base(repo)}/branch`, { ...opts(repo), query: q(repo, { name: repo.branch }) });

/** The commits at the tip of a ref, newest first: `[{ shortId, title, authorName, createdAt }]`. */
export const getCommits = ({ ref = 'main', perPage = 20, ...repo }) => linea.get(`${base(repo)}/commits`, { ...opts(repo), query: q(repo, { ref, perPage }) });

/** What `to` has that `from` has not: `{ commits, files: [{ oldPath, newPath, status, additions, deletions, patch }] }`. */
export const compareBranches = ({ from, to, ...repo }) => linea.get(`${base(repo)}/compare`, { ...opts(repo), query: q(repo, { from, to }) });

/** Every file of the repository at `ref`, as paths. */
export const listFiles = ({ ref = 'main', ...repo }) => linea.get(`${base(repo)}/files`, { ...opts(repo), query: q(repo, { ref }) });

/** A file at `ref` as `{ path, content (base64), revision }`, or `null` when there is none. */
export const getFile = async ({ path, ref = 'main', ...repo }) => {
  try {
    return await linea.get(`${base(repo)}/file`, { ...opts(repo), query: q(repo, { path, ref }) });
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
};

/** The text of a file at `ref`, or `null` when there is none. */
export const readFile = async (args) => {
  const file = await getFile(args);
  return file ? Buffer.from(file.content, 'base64').toString('utf8') : null;
};

/** Makes `branch` from `ref`. Throws `isBranchAlreadyExistsError` when there is one. */
export const createBranch = ({ branch, ref, ...repo }) => linea.post(`${base(repo)}/branches`, { branch, ref }, { ...opts(repo), query: q(repo) });

/** `actions`: `[{ action: 'create' | 'update' | 'delete', path, content }]`, one commit on `branch`. */
export const commit = ({ branch, message, actions, ...repo }) => linea.post(`${base(repo)}/commits`, { branch, message, actions }, { ...opts(repo), query: q(repo) });

/** The merge requests (`state`: opened, merged, closed, all), as LINEA shows them: `[{ number, title, sourceBranch, targetBranch, webUrl, hasConflicts }]`. */
export const listMergeRequests = async ({ state = 'opened', targetBranch, sourceBranch, perPage = 100, ...repo }) => {
  const page = await linea.get(`${base(repo)}/mrs`, { ...opts(repo), query: q(repo, { state, targetBranch, sourceBranch, perPage }) });
  return page.items;
};

/** One merge request in full: unlike the list, it says whether it has conflicts on every host. */
export const getMergeRequest = ({ number, ...repo }) => linea.get(`${base(repo)}/mrs/${number}`, { ...opts(repo), query: q(repo) });

export const createMergeRequest = ({ title, description, sourceBranch, targetBranch, ...repo }) =>
  linea.post(`${base(repo)}/mrs`, { title, description, sourceBranch, targetBranch }, { ...opts(repo), query: q(repo) });

/** The files a merge request changes: `[{ oldPath, newPath, status, additions, deletions, patch }]`. */
export const getMergeRequestChanges = ({ number, ...repo }) => linea.get(`${base(repo)}/mrs/${number}/diff`, { ...opts(repo), query: q(repo) });

export const postMergeRequestComment = ({ number, body, ...repo }) => linea.post(`${base(repo)}/mrs/${number}/threads`, { body }, { ...opts(repo), query: q(repo) });

/** Asks the host to tell LINEA about the pushes to the repository: `{ status }`. */
export const ensurePushHook = (repo) => linea.post(`${base(repo)}/push-hook`, {}, { ...opts(repo), query: q(repo) });

/** Whether a failed `createBranch` was only that the branch is already there (LINEA says what the host said in `detail`). */
export const isBranchAlreadyExistsError = (error) =>
  [400, 409, 422].includes(error?.status) && /already exist/i.test(`${error?.message ?? ''} ${error?.body?.detail ?? ''} ${error?.body?.error ?? ''}`);

/** Merges a merge request when the host lets it: `{ merged: true }` or `{ merged: false, conflicts: true }`. */
export const mergeMergeRequest = async ({ number, squash, deleteSourceBranch, ...repo }) => {
  try {
    return await linea.post(`${base(repo)}/mrs/${number}/merge`, { squash, deleteSourceBranch }, { ...opts(repo), query: q(repo) });
  } catch (error) {
    // LINEA answers 409 with the outcome when it cannot merge
    if (error?.status === 409 && error.body && typeof error.body === 'object' && 'merged' in error.body) return error.body;
    throw error;
  }
};

/** A zip of the repository at `ref`, as a Buffer. */
export const downloadArchive = ({ ref = 'main', timeoutMs = 120_000, ...repo }) =>
  linea.get(`${base(repo)}/archive`, { ...opts(repo), query: q(repo, { ref }), binary: true, timeoutMs });
