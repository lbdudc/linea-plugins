import express from 'express';
import crypto from 'crypto';
import JSZip from 'jszip';

const CLIENT_ERROR_JSON = (message) => ({ error: message, message });

const sha1For = (seedText) => crypto.createHash('sha1').update(seedText).digest('hex');

const shortId = (sha) => sha.slice(0, 8);

const slugify = (name) =>
  String(name)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

class ProjectState {
  constructor({ id, name, namespace, topics, defaultBranch, initializeWithReadme, webBase }) {
    this.id = id;
    this.name = name;
    this.path = slugify(name);
    this.namespace = namespace;
    this.path_with_namespace = namespace.full_path ? `${namespace.full_path}/${this.path}` : this.path;
    this.topics = topics ?? [];
    this.default_branch = defaultBranch ?? 'main';
    this.archived = false;
    this.marked_for_deletion_at = null;
    this.web_url = `${webBase}/${this.path_with_namespace}`;
    this.members = [];
    this.hooks = [];
    this.nextHookId = 1;
    this.nextMrIid = 1;
    this.mergeRequests = new Map();
    this.tags = new Map();
    this.commits = new Map();
    this.branches = new Map();

    const initialTree = new Map();
    if (initializeWithReadme) initialTree.set('README.md', Buffer.from(`# ${name}\n`, 'utf8'));
    const initialCommit = this.#newCommit({ tree: initialTree, parent: null, message: 'Initial commit' });
    this.branches.set(this.default_branch, initialCommit.id);
  }

  #newCommit({ tree, parent, message }) {
    const seq = this.commits.size + 1;
    const id = sha1For(`${this.id}|${seq}|${message}`);
    const commit = {
      id,
      short_id: shortId(id),
      title: message,
      message,
      parent_ids: parent ? [parent] : [],
      created_at: new Date().toISOString(),
      author_name: 'gitlab-double',
      web_url: `${this.web_url}/-/commit/${id}`,
      tree,
    };
    this.commits.set(id, commit);
    return commit;
  }

  headSha(branch) {
    return this.branches.get(branch);
  }

  resolveRef(ref) {
    if (this.branches.has(ref)) return this.branches.get(ref);
    if (this.commits.has(ref)) return ref;
    return null;
  }

  treeAt(ref) {
    const sha = this.resolveRef(ref);
    if (!sha) return null;
    return this.commits.get(sha).tree;
  }

  commit({ branch, actions, message, expectedLastCommitId }) {
    const headSha = this.branches.get(branch);
    if (!headSha) throw { status: 404, body: CLIENT_ERROR_JSON(`404 Branch Not Found`) };

    if (expectedLastCommitId !== undefined && expectedLastCommitId !== null && expectedLastCommitId !== headSha) {
      throw {
        status: 400,
        body: CLIENT_ERROR_JSON(
          `last_commit_id (${expectedLastCommitId}) is not HEAD of ${branch} (${headSha}) — someone else committed first`
        ),
      };
    }

    const baseTree = this.commits.get(headSha).tree;
    const newTree = new Map(baseTree);

    for (const action of actions ?? []) {
      const filePath = action.file_path;
      const exists = newTree.has(filePath);

      if (
        ['update', 'move', 'delete'].includes(action.action) &&
        action.last_commit_id !== undefined && action.last_commit_id !== null &&
        action.last_commit_id !== headSha
      ) {
        throw {
          status: 400,
          body: CLIENT_ERROR_JSON(
            `last_commit_id (${action.last_commit_id}) is not HEAD of ${branch} (${headSha}) for ${filePath} — someone else committed first`
          ),
        };
      }

      if (action.action === 'create') {
        if (exists) throw { status: 400, body: CLIENT_ERROR_JSON(`A file with this name already exists (${filePath})`) };
        newTree.set(filePath, decodeActionContent(action));
      } else if (action.action === 'update') {
        if (!exists) throw { status: 400, body: CLIENT_ERROR_JSON(`A file with this name doesn't exist (${filePath})`) };
        newTree.set(filePath, decodeActionContent(action));
      } else if (action.action === 'delete') {
        if (!exists) throw { status: 400, body: CLIENT_ERROR_JSON(`A file with this name doesn't exist (${filePath})`) };
        newTree.delete(filePath);
      } else if (action.action === 'move') {
        if (!exists) throw { status: 400, body: CLIENT_ERROR_JSON(`A file with this name doesn't exist (${filePath})`) };
        const content = action.content !== undefined ? decodeActionContent(action) : newTree.get(filePath);
        newTree.delete(filePath);
        newTree.set(action.previous_path ? filePath : action.file_path, content);
      } else {
        throw { status: 400, body: CLIENT_ERROR_JSON(`Unknown action "${action.action}"`) };
      }
    }

    const commit = this.#newCommit({ tree: newTree, parent: headSha, message });
    this.branches.set(branch, commit.id);
    return commit;
  }

  createBranch(name, ref) {
    if (this.branches.has(name)) {
      throw { status: 400, body: CLIENT_ERROR_JSON(`Branch already exists`) };
    }
    const sha = this.resolveRef(ref);
    if (!sha) throw { status: 404, body: CLIENT_ERROR_JSON(`404 Ref Not Found`) };
    this.branches.set(name, sha);
    return { name, commit: this.commits.get(sha) };
  }
}

const decodeActionContent = (action) => {
  if (action.encoding === 'base64') return Buffer.from(action.content ?? '', 'base64');
  return Buffer.from(action.content ?? '', 'utf8');
};

class GitLabDoubleState {
  constructor(webBase) {
    this.webBase = webBase;
    this.groups = new Map();
    this.projects = new Map();
    this.nextGroupId = 1;
    this.nextProjectId = 1;
    this.requestLog = [];
  }

  createGroup({ name, path, parent_id }) {
    const id = this.nextGroupId++;
    const parent = parent_id ? this.groups.get(parent_id) : null;
    const groupPath = path || slugify(name);
    const full_path = parent ? `${parent.full_path}/${groupPath}` : groupPath;
    const group = {
      id, name, path: groupPath, full_path,
      parent_id: parent_id ?? null,
      web_url: `${this.webBase}/${full_path}`,
      members: [],
    };
    this.groups.set(id, group);
    return group;
  }

  createProject({ name, namespace_id, topics, default_branch, initialize_with_readme }) {
    const namespaceGroup = this.groups.get(namespace_id);
    if (!namespaceGroup) throw { status: 404, body: CLIENT_ERROR_JSON('404 Group Not Found') };
    const id = this.nextProjectId++;
    const project = new ProjectState({
      id, name,
      namespace: { id: namespaceGroup.id, full_path: namespaceGroup.full_path, parent_id: namespaceGroup.parent_id },
      topics, defaultBranch: default_branch, initializeWithReadme: initialize_with_readme,
      webBase: this.webBase,
    });
    this.projects.set(id, project);
    return project;
  }

  reset() {
    this.groups.clear();
    this.projects.clear();
    this.nextGroupId = 1;
    this.nextProjectId = 1;
    this.requestLog = [];
  }
}

const projectJson = (p) => ({
  id: p.id,
  name: p.name,
  path: p.path,
  path_with_namespace: p.path_with_namespace,
  namespace: { id: p.namespace.id, full_path: p.namespace.full_path, parent_id: p.namespace.parent_id ?? null },
  topics: p.topics,
  tag_list: p.topics,
  default_branch: p.default_branch,
  archived: p.archived,
  marked_for_deletion_at: p.marked_for_deletion_at,
  web_url: p.web_url,
  description: '',
});

const mrJson = (project, mr) => ({
  id: mr.iid,
  iid: mr.iid,
  project_id: project.id,
  title: mr.title,
  source_branch: mr.source_branch,
  target_branch: mr.target_branch,
  state: mr.state,
  merge_status: mr.state === 'merged' ? 'merged' : 'can_be_merged',
  detailed_merge_status: mr.detailed_merge_status,
  has_conflicts: false,
  web_url: `${project.web_url}/-/merge_requests/${mr.iid}`,
  sha: mr.sha,
});

const fileJson = (project, branchOrRef, filePath, sha, content) => ({
  file_name: filePath.split('/').pop(),
  file_path: filePath,
  size: content.length,
  encoding: 'base64',
  content_sha256: sha1For(content),
  ref: branchOrRef,
  blob_id: sha1For(`${filePath}@${sha}`),
  commit_id: sha,
  last_commit_id: sha,
  content: content.toString('base64'),
});

export function createGitlabDoubleApp(webBase = 'http://gitlab-double.local') {
  const state = new GitLabDoubleState(webBase);
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.use((req, res, next) => {
    state.requestLog.push({
      method: req.method,
      path: req.originalUrl.replace(/^\/api\/v4\//, ''),
      body: req.body && Object.keys(req.body).length > 0 ? req.body : undefined,
    });
    next();
  });

  const router = express.Router();

  const sendError = (res, status, message) => res.status(status).json(CLIENT_ERROR_JSON(message));
  const projectOr404 = (req, res) => {
    const project = state.projects.get(Number(req.params.id));
    if (!project) { sendError(res, 404, '404 Project Not Found'); return null; }
    return project;
  };
  const groupOr404 = (req, res) => {
    const group = state.groups.get(Number(req.params.id));
    if (!group) { sendError(res, 404, '404 Group Not Found'); return null; }
    return group;
  };

  router.post('/groups', (req, res) => {
    const group = state.createGroup(req.body ?? {});
    res.status(201).json(group);
  });
  router.get('/groups/:id', (req, res) => {
    const group = groupOr404(req, res);
    if (group) res.status(200).json(group);
  });
  router.put('/groups/:id', (req, res) => {
    const group = groupOr404(req, res);
    if (!group) return;
    if (req.body?.name !== undefined) group.name = req.body.name;
    res.status(200).json(group);
  });
  router.delete('/groups/:id', (req, res) => {
    const group = groupOr404(req, res);
    if (!group) return;
    state.groups.delete(group.id);
    for (const [id, project] of state.projects) {
      if (project.namespace.id === group.id) state.projects.delete(id);
    }
    res.status(202).json({ message: '202 Accepted' });
  });
  router.get('/groups', (req, res) => {
    const minAccessLevel = Number(req.query.min_access_level ?? 0);
    const perPage = Number(req.query.per_page ?? 20);
    const page = Number(req.query.page ?? 1);
    void minAccessLevel;
    const all = [...state.groups.values()];
    const start = (page - 1) * perPage;
    res.status(200).json(all.slice(start, start + perPage));
  });
  router.get('/groups/:id/members/all', (req, res) => {
    const group = groupOr404(req, res);
    if (group) res.status(200).json(group.members);
  });

  router.post('/projects', (req, res) => {
    try {
      const project = state.createProject(req.body ?? {});
      res.status(201).json(projectJson(project));
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('create project failed'));
    }
  });
  router.get('/projects/:id', (req, res) => {
    const project = projectOr404(req, res);
    if (project) res.status(200).json(projectJson(project));
  });
  router.put('/projects/:id', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (req.body?.name !== undefined) project.name = req.body.name;
    if (req.body?.default_branch !== undefined) project.default_branch = req.body.default_branch;
    res.status(200).json(projectJson(project));
  });
  router.delete('/projects/:id', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    state.projects.delete(project.id);
    res.status(202).json({ message: 'Accepted' });
  });
  router.get('/projects/:id/members/all', (req, res) => {
    const project = projectOr404(req, res);
    if (project) res.status(200).json(project.members);
  });
  router.get('/projects', (req, res) => {
    const perPageRaw = req.query.per_page;
    const perPage = perPageRaw !== undefined ? Number(perPageRaw) : null;
    const page = Number(req.query.page ?? 1);
    let results = [...state.projects.values()];

    if (req.query.topics) {
      const wanted = String(req.query.topics).split(',').map((t) => t.trim()).filter(Boolean);
      results = results.filter((p) => wanted.every((t) => p.topics.includes(t)));
    }
    if (req.query.topic) {
      results = results.filter((p) => p.topics.includes(String(req.query.topic)));
    }
    results = results.filter((p) => !p.archived);

    if (perPage === null) {
      res.status(200).json(results.map(projectJson));
      return;
    }
    const start = (page - 1) * perPage;
    res.status(200).json(results.slice(start, start + perPage).map(projectJson));
  });

  router.get('/projects/:id/repository/files/:path', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const filePath = decodeURIComponent(req.params.path);
    const ref = req.query.ref ?? project.default_branch;
    const sha = project.resolveRef(ref);
    if (!sha) return sendError(res, 404, '404 Commit Not Found');
    const tree = project.commits.get(sha).tree;
    if (!tree.has(filePath)) return sendError(res, 404, '404 File Not Found');
    res.status(200).json(fileJson(project, ref, filePath, sha, tree.get(filePath)));
  });
  router.post('/projects/:id/repository/files/:path', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const filePath = decodeURIComponent(req.params.path);
    const { branch, content, commit_message, encoding } = req.body ?? {};
    try {
      const commit = project.commit({
        branch,
        actions: [{ action: 'create', file_path: filePath, content, encoding }],
        message: commit_message ?? `Added ${filePath}`,
      });
      res.status(201).json({ file_path: filePath, branch, ...fileJson(project, branch, filePath, commit.id, project.commits.get(commit.id).tree.get(filePath)) });
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('create file failed'));
    }
  });
  router.put('/projects/:id/repository/files/:path', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const filePath = decodeURIComponent(req.params.path);
    const { branch, content, commit_message, encoding, last_commit_id } = req.body ?? {};
    try {
      const commit = project.commit({
        branch,
        actions: [{ action: 'update', file_path: filePath, content, encoding }],
        message: commit_message ?? `Updated ${filePath}`,
        expectedLastCommitId: last_commit_id,
      });
      res.status(200).json({ file_path: filePath, branch, ...fileJson(project, branch, filePath, commit.id, project.commits.get(commit.id).tree.get(filePath)) });
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('update file failed'));
    }
  });

  router.post('/projects/:id/repository/commits', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { branch, commit_message, actions, last_commit_id } = req.body ?? {};
    try {
      const commit = project.commit({ branch, actions, message: commit_message, expectedLastCommitId: last_commit_id });
      res.status(201).json({
        id: commit.id, short_id: commit.short_id, title: commit.title, message: commit.message,
        created_at: commit.created_at, web_url: commit.web_url, parent_ids: commit.parent_ids,
      });
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('commit failed'));
    }
  });
  router.get('/projects/:id/repository/commits', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const refName = req.query.ref_name ?? project.default_branch;
    const perPage = Number(req.query.per_page ?? 20);
    let sha = project.resolveRef(refName);
    const out = [];
    while (sha && out.length < perPage) {
      const commit = project.commits.get(sha);
      out.push(commit);
      sha = commit.parent_ids[0] ?? null;
    }
    res.status(200).json(out.map((c) => ({
      id: c.id, short_id: c.short_id, title: c.title, message: c.message,
      author_name: c.author_name, created_at: c.created_at, web_url: c.web_url,
    })));
  });
  router.post('/projects/:id/repository/commits/:sha/revert', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const target = project.commits.get(req.params.sha);
    if (!target) return sendError(res, 404, '404 Commit Not Found');
    const { branch, dry_run } = req.body ?? {};
    if (dry_run) {
      res.status(200).json({ dry_run: 'success' });
      return;
    }
    const parentSha = target.parent_ids[0] ?? null;
    const parentTree = parentSha ? project.commits.get(parentSha).tree : new Map();
    const headSha = project.branches.get(branch);
    if (!headSha) return sendError(res, 404, '404 Branch Not Found');
    const headTree = project.commits.get(headSha).tree;
    const revertedTree = new Map(headTree);
    for (const [path, content] of target.tree) {
      if (parentTree.has(path)) revertedTree.set(path, parentTree.get(path));
      else revertedTree.delete(path);
    }
    for (const path of parentTree.keys()) {
      if (!target.tree.has(path) && !revertedTree.has(path)) revertedTree.set(path, parentTree.get(path));
    }
    const seq = project.commits.size + 1;
    const id = sha1For(`${project.id}|revert|${seq}`);
    const revertCommit = {
      id, short_id: shortId(id), title: `Revert "${target.title}"`, message: `Revert "${target.title}"`,
      parent_ids: [headSha], created_at: new Date().toISOString(), author_name: 'gitlab-double',
      web_url: `${project.web_url}/-/commit/${id}`, tree: revertedTree,
    };
    project.commits.set(id, revertCommit);
    project.branches.set(branch, id);
    res.status(200).json({ id, short_id: shortId(id) });
  });

  router.get('/projects/:id/repository/tree', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const ref = req.query.ref || project.default_branch;
    const tree = project.treeAt(ref);
    if (!tree) return sendError(res, 404, '404 Tree Not Found');
    const prefix = req.query.path ? `${req.query.path}/` : '';
    const perPage = Number(req.query.per_page ?? 100);
    const entries = [...tree.keys()]
      .filter((p) => p.startsWith(prefix))
      .slice(0, perPage)
      .map((p) => ({
        id: sha1For(`${project.id}:${p}`),
        name: p.split('/').pop(),
        type: 'blob',
        path: p,
        mode: '100644',
      }));
    res.status(200).json(entries);
  });

  router.get('/projects/:id/repository/archive.zip', async (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const ref = req.query.sha || project.default_branch;
    const tree = project.treeAt(ref);
    if (!tree) return sendError(res, 404, '404 Tree Not Found');
    const sha = project.resolveRef(ref);
    const rootFolder = `${project.path}-${shortId(sha)}`;
    const zip = new JSZip();
    for (const [filePath, content] of tree) {
      zip.file(`${rootFolder}/${filePath}`, content);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.status(200).set('Content-Type', 'application/zip').send(buffer);
  });

  router.post('/projects/:id/repository/branches', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { branch, ref } = req.body ?? {};
    try {
      const created = project.createBranch(branch, ref);
      res.status(201).json({
        name: created.name,
        commit: { id: created.commit.id, short_id: created.commit.short_id },
        default: false, protected: false, merged: false,
        web_url: `${project.web_url}/-/tree/${created.name}`,
      });
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('create branch failed'));
    }
  });
  router.delete('/projects/:id/repository/branches/:name', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (!project.branches.has(req.params.name)) return sendError(res, 404, '404 Branch Not Found');
    project.branches.delete(req.params.name);
    res.status(204).send();
  });
  router.get('/projects/:id/repository/branches/:name', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const sha = project.branches.get(req.params.name);
    if (!sha) return sendError(res, 404, '404 Branch Not Found');
    const commit = project.commits.get(sha);
    res.status(200).json({
      name: req.params.name, commit: { id: commit.id, short_id: commit.short_id, title: commit.title },
      default: req.params.name === project.default_branch, protected: false, merged: false,
      web_url: `${project.web_url}/-/tree/${req.params.name}`,
    });
  });
  router.get('/projects/:id/repository/branches', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const search = req.query.search ? String(req.query.search) : null;
    const perPage = Number(req.query.per_page ?? 30);
    let names = [...project.branches.keys()];
    if (search) names = names.filter((n) => n.includes(search));
    res.status(200).json(names.slice(0, perPage).map((name) => {
      const commit = project.commits.get(project.branches.get(name));
      return {
        name, commit: { id: commit.id, short_id: commit.short_id },
        default: name === project.default_branch, protected: false, merged: false,
        web_url: `${project.web_url}/-/tree/${name}`,
      };
    }));
  });

  router.get('/projects/:id/repository/compare', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const fromSha = project.resolveRef(req.query.from);
    const toSha = project.resolveRef(req.query.to);
    if (!fromSha || !toSha) return sendError(res, 404, '404 Ref Not Found');
    const commits = [];
    let sha = toSha;
    while (sha && sha !== fromSha && commits.length < 200) {
      const commit = project.commits.get(sha);
      commits.push(commit);
      sha = commit.parent_ids[0] ?? null;
    }
    res.status(200).json({
      commits: commits.reverse().map((c) => ({
        id: c.id, short_id: c.short_id, title: c.title, author_name: c.author_name, created_at: c.created_at,
      })),
      diffs: [],
      compare_same_ref: fromSha === toSha,
    });
  });

  const createMr = (project, { title, source_branch, target_branch }) => {
    if (!project.branches.has(source_branch)) throw { status: 400, body: CLIENT_ERROR_JSON('source branch does not exist') };
    if (!project.branches.has(target_branch)) throw { status: 400, body: CLIENT_ERROR_JSON('target branch does not exist') };
    const iid = project.nextMrIid++;
    const mr = {
      iid, title, source_branch, target_branch,
      state: 'opened', detailed_merge_status: 'mergeable',
      sha: project.branches.get(source_branch),
    };
    project.mergeRequests.set(iid, mr);
    return mr;
  };

  router.post('/projects/:id/merge_requests', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const { title, source_branch, target_branch } = req.body ?? {};
    const existing = [...project.mergeRequests.values()].find(
      (m) => m.state === 'opened' && m.source_branch === source_branch && m.target_branch === target_branch
    );
    if (existing) return sendError(res, 409, 'Another open merge request already exists for this source branch');
    try {
      const mr = createMr(project, { title, source_branch, target_branch });
      res.status(201).json(mrJson(project, mr));
    } catch (err) {
      res.status(err.status ?? 400).json(err.body ?? CLIENT_ERROR_JSON('create MR failed'));
    }
  });
  router.get('/projects/:id/merge_requests/:iid', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    res.status(200).json(mrJson(project, mr));
  });
  router.get('/projects/:id/merge_requests', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    let mrs = [...project.mergeRequests.values()];
    if (req.query.state) mrs = mrs.filter((m) => m.state === req.query.state);
    if (req.query.target_branch) mrs = mrs.filter((m) => m.target_branch === req.query.target_branch);
    if (req.query.source_branch) mrs = mrs.filter((m) => m.source_branch === req.query.source_branch);
    res.status(200).json(mrs.map((m) => mrJson(project, m)));
  });
  router.put('/projects/:id/merge_requests/:iid', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    if (req.query.title !== undefined) mr.title = req.query.title;
    if (req.query.state_event === 'close') mr.state = 'closed';
    if (req.query.state_event === 'reopen') mr.state = 'opened';
    res.status(200).json(mrJson(project, mr));
  });
  router.put('/projects/:id/merge_requests/:iid/merge', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    if (mr.state !== 'opened') {
      res.status(406).json(CLIENT_ERROR_JSON('Branch cannot be merged'));
      return;
    }
    project.branches.set(mr.target_branch, mr.sha);
    mr.state = 'merged';
    mr.detailed_merge_status = 'not_open';
    if (String(req.query.should_remove_source_branch) === 'true') {
      project.branches.delete(mr.source_branch);
    }
    res.status(200).json(mrJson(project, mr));
  });
  router.delete('/projects/:id/merge_requests/:iid', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (!project.mergeRequests.has(Number(req.params.iid))) return sendError(res, 404, '404 Merge Request Not Found');
    project.mergeRequests.delete(Number(req.params.iid));
    res.status(204).send();
  });

  router.post('/projects/:id/repository/tags', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const tagName = req.query.tag_name ?? req.body?.tag;
    const ref = req.query.ref ?? req.body?.ref;
    if (project.tags.has(tagName)) return sendError(res, 400, 'Tag already exists');
    const sha = project.resolveRef(ref);
    if (!sha) return sendError(res, 404, '404 Ref Not Found');
    project.tags.set(tagName, sha);
    res.status(201).json({ name: tagName, target: sha, commit: { id: sha } });
  });
  router.delete('/projects/:id/repository/tags/:name', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (!project.tags.has(req.params.name)) return sendError(res, 404, '404 Tag Not Found');
    project.tags.delete(req.params.name);
    res.status(204).send();
  });

  router.get('/projects/:id/hooks', (req, res) => {
    const project = projectOr404(req, res);
    if (project) res.status(200).json(project.hooks);
  });
  router.post('/projects/:id/hooks', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const hook = { id: project.nextHookId++, ...req.body };
    project.hooks.push(hook);
    res.status(201).json(hook);
  });
  router.delete('/projects/:id/hooks/:hookId', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const index = project.hooks.findIndex((h) => h.id === Number(req.params.hookId));
    if (index < 0) return sendError(res, 404, '404 Not found');
    project.hooks.splice(index, 1);
    res.status(204).send();
  });

  router.get('/projects/:id/pipelines', (req, res) => {
    const project = projectOr404(req, res);
    if (project) res.status(200).json([]);
  });

  router.get('/projects/:id/merge_requests/:iid/changes', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    const mr = project.mergeRequests.get(Number(req.params.iid));
    if (!mr) return sendError(res, 404, '404 Merge Request Not Found');
    res.status(200).json({ ...mrJson(project, mr), changes: [] });
  });
  router.post('/projects/:id/merge_requests/:iid/notes', (req, res) => {
    const project = projectOr404(req, res);
    if (!project) return;
    if (!project.mergeRequests.has(Number(req.params.iid))) return sendError(res, 404, '404 Merge Request Not Found');
    res.status(201).json({ id: 1, body: req.body?.body ?? '' });
  });

  app.use('/api/v4', router);

  app.use((req, res) => {
    res.status(501).json(CLIENT_ERROR_JSON(`gitlabDouble: no handler for ${req.method} ${req.originalUrl}`));
  });

  return { app, state };
}

export async function startGitlabDouble() {
  const { app, state } = createGitlabDoubleApp();

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    state,
    getProject: (id) => state.projects.get(id),
    seedProject: ({ name, groupName, topics, defaultBranch, initializeWithReadme = true }) => {
      const group = state.createGroup({ name: groupName ?? name });
      return state.createProject({
        name, namespace_id: group.id, topics, default_branch: defaultBranch,
        initialize_with_readme: initializeWithReadme,
      });
    },
    getLog: () => [...state.requestLog],
    clearLog: () => { state.requestLog = []; },
    reset: () => state.reset(),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
