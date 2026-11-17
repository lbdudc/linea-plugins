import fetch from "node-fetch";
import { getGitLabUrl } from "./properties.js";
import { GitLabError, GitLabAuthError } from "gitlab-commando";

export const getCommits = async ({ token, id, ref = 'main', perPage = 7 }) => {
  return appFetch({
    token,
    method: 'GET',
    path: `projects/${id}/repository/commits?ref_name=${encodeURIComponent(ref)}&per_page=${perPage}`,
  });
};

export const getMergeRequests = async ({ token, id, state = 'opened', targetBranch }) => {
  let path = `projects/${id}/merge_requests?state=${state}&per_page=20`;
  if (targetBranch) path += `&target_branch=${encodeURIComponent(targetBranch)}`;
  return appFetch({ token, method: 'GET', path });
};

export const getPipelines = async ({ token, id, ref = 'main', perPage = 1 }) => {
  return appFetch({
    token,
    method: 'GET',
    path: `projects/${id}/pipelines?ref=${encodeURIComponent(ref)}&per_page=${perPage}`,
  });
};

export const getBranch = async ({ token, id, branch }) => {
  return appFetch({
    token,
    method: 'GET',
    path: `projects/${id}/repository/branches/${encodeURIComponent(branch)}`,
  });
};

// Conflicting files + per-side diffs for a specific merge request.
export const getMergeRequestChanges = async ({ token, id, mrIid }) => {
  return appFetch({
    token,
    method: 'GET',
    path: `projects/${id}/merge_requests/${mrIid}/changes`,
  });
};

// Commits in `from` not in `to` (and diff stats). Used to detect branch drift.
export const compareBranches = async ({ token, id, from, to }) => {
  return appFetch({
    token,
    method: 'GET',
    path: `projects/${id}/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  });
};

// Last N commits on a branch (author/message/timestamp) — anti-pattern detection.
// Pass `until` (ISO 8601) to anchor the window to a specific point in time.
export const getBranchCommits = async ({ token, id, branch, perPage = 20, until }) => {
  let path = `projects/${id}/repository/commits?ref_name=${encodeURIComponent(branch)}&per_page=${perPage}`;
  if (until) path += `&until=${encodeURIComponent(until)}`;
  return appFetch({ token, method: 'GET', path });
};

// List files in a repository subtree (used to discover platform template files).
export const getRepositoryTree = async ({ token, id, path = '', recursive = true, perPage = 100, ref = null }) => {
  const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : '';
  return appFetch({
    token,
    method: 'GET',
    path: `projects/${id}/repository/tree?path=${encodeURIComponent(path)}&recursive=${recursive}&per_page=${perPage}${refParam}`,
  });
};

export const listBranches = async ({ token, id, search = '', perPage = 30 }) => {
  let p = `projects/${id}/repository/branches?per_page=${perPage}`;
  if (search) p += `&search=${encodeURIComponent(search)}`;
  return appFetch({ token, method: 'GET', path: p });
};

export const createBranch = async ({ token, id, branch, ref }) => {
  return appFetch({
    token,
    method: 'POST',
    path: `projects/${id}/repository/branches`,
    body: { branch, ref },
  });
};

export const isBranchAlreadyExistsError = (err) => {
  const status = err?.response?.status ?? err?.status ?? 0;
  if (![400, 409, 422].includes(status)) return false;
  const message = String(err?.message ?? '');
  return /already exists/i.test(message);
};

// Post a comment (note) on a merge request — the agents' proposal surface.
export const postMergeRequestComment = async ({ token, id, mrIid, body }) => {
  return appFetch({
    token,
    method: 'POST',
    path: `projects/${id}/merge_requests/${mrIid}/notes`,
    body: { body },
  });
};

export const downloadRepositoryFile = async ({ token, id, file, ref = "main" }) => {
  const response = await appFetch({
    token,
    method: "GET",
    path: `projects/${id}/repository/${file}?sha=${ref}`,
    json: false,
  });
  if (!response.ok)
    throw new Error(`Unexpected response ${response.statusText}`);
  return response.body;
}

export const getRepositoryFileMeta = async ({ token, id, filePath, ref }) => {
  return appFetch({
    token,
    method: 'GET',
    path: `projects/${id}/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`,
  });
};

export const commitActions = async ({ token, id, branch, message, actions }) => {
  return appFetch({
    token,
    method: 'POST',
    path: `projects/${id}/repository/commits`,
    body: { branch, commit_message: message, actions },
  });
};

// List the project's currently registered webhooks. Used to avoid registering
// the same LINEA webhook twice on a project.
export const listProjectHooks = async ({ token, id }) => {
  return appFetch({
    token,
    method: 'GET',
    path: `projects/${id}/hooks?per_page=100`,
  });
};

// Register a push-events webhook on a project. The `token` field is the GitLab
// "Secret Token" — GitLab will send it back to us as the `X-Gitlab-Token`
// header, which our intake compares against GITLAB_WEBHOOK_SECRET.
export const createProjectHook = async ({ token, id, url, secret, branch = 'main' }) => {
  return appFetch({
    token,
    method: 'POST',
    path: `projects/${id}/hooks`,
    body: {
      url,
      token: secret,
      push_events: true,
      push_events_branch_filter: branch,
      enable_ssl_verification: !url.startsWith('http://'),
    },
  });
};

export const deleteProjectHook = async ({ token, id, hookId }) => {
  const res = await appFetch({ token, method: 'DELETE', path: `projects/${id}/hooks/${hookId}`, json: false });
  if (!res.ok) {
    const error = res.status === 401 ? new GitLabAuthError(res.statusText) : new GitLabError(res.statusText);
    error.status = res.status;
    throw error;
  }
};

// Groups the user is a member of at `minAccessLevel` or above — the candidate
// parents for a new line's group. 30 (developer) is the lowest level GitLab
// ever allows group content creation at; each group's own
// subgroup_creation_level still has the final say, so creation may still be
// refused and surfaces as a GitLabError.
export const getGroups = async ({ token, minAccessLevel = 30 }) => {
  const all = [];
  let page = 1;
  let batch;
  do {
    batch = await appFetch({
      token,
      method: 'GET',
      path: `groups?min_access_level=${minAccessLevel}&per_page=100&page=${page}&order_by=path&sort=asc`,
    });
    all.push(...batch);
    page++;
  } while (batch.length > 0);
  return all;
};

export const getEnrolledProjects = async ({ token, topic }) => {
  const all = [];
  let page = 1;
  let batch;
  do {
    batch = await appFetch({
      token,
      method: 'GET',
      path: `projects?membership=true&topic=${encodeURIComponent(topic)}&per_page=100&page=${page}`,
    });
    all.push(...batch);
    page++;
  } while (batch.length > 0);
  // A project whose own `marked_for_deletion_at` is unset can still be
  // effectively gone: delayed group deletion renames the parent namespace to
  // `<name>-deletion_scheduled-<id>` immediately, but doesn't necessarily set
  // this flag on every project underneath it until the group is actually
  // purged. Catch that via the renamed namespace path rather than relying on
  // a field GitLab may not have propagated down yet.
  const isGroupPendingDeletion = (p) => /-deletion_scheduled-\d+/.test(p.namespace?.full_path ?? p.namespace?.path ?? '');
  return all.filter(p => !p.archived && !p.marked_for_deletion_at && !isGroupPendingDeletion(p));
};

// Without this, a GitLab call that never gets a response (dropped connection,
// overloaded instance) hangs until the OS network stack eventually gives up —
// we saw this take 5+ minutes, surfacing only as a generic 500 with no clue
// which call stalled. Fail fast instead, as a proper GitLabError.
const GITLAB_REQUEST_TIMEOUT_MS = 30000;

const appFetch = async ({ token, method, path, body, json = true }) => {
  const init = {
    method,
    headers: { "Authorization": `Bearer ${token}` },
    signal: AbortSignal.timeout(GITLAB_REQUEST_TIMEOUT_MS),
  };
  if (body !== undefined) {
    Object.assign(init.headers, { "Content-Type": "application/json" });
    Object.assign(init, { body: JSON.stringify(body) });
  }

  let res;
  try {
    res = await fetch(`${getGitLabUrl()}/api/v4/${path}`, init);
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new GitLabError(`GitLab request timed out after ${GITLAB_REQUEST_TIMEOUT_MS}ms: ${method} ${path}`);
    }
    throw new GitLabError(error.message ?? String(error));
  }

  if (!json) {
    return res;
  } else if (res.ok) {
    return await res.json();
  } else {
    let errorData = {};
    try {
      const raw = await res.text();
      errorData = raw ? JSON.parse(raw) : {};
    } catch {
      errorData = {};
    }
    const error = res.status === 401 ? new GitLabAuthError(errorData.error) : new GitLabError(errorData.message ?? res.statusText);
    error.status = res.status;
    throw error;
  }
}
