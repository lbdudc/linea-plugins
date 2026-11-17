import crypto from 'node:crypto';
import express from 'express';
import JSZip from 'jszip';

/**
 * The git side of the fake LINEA: repositories kept in memory, answering at `/api/repos/:id/*` as the real LINEA does (see
 * server/src/linea/repo.js). A test seeds repositories and looks at what agents did to them (`fakeLinea().git`).
 */
const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');
const refusal = (status, message) => ({ status, body: { error: message } });

class Repo {
  constructor({ id, name, topics = [], defaultBranch = 'main' }) {
    this.id = id;
    this.name = name;
    this.topics = topics;
    this.defaultBranch = defaultBranch;
    this.webUrl = `http://git.local/${name}`;
    this.commits = new Map();
    this.branches = new Map();
    this.mergeRequests = new Map();
    this.nextMr = 1;
    this.hooks = 0;
    this.branches.set(defaultBranch, this.#commit({ tree: new Map(), parent: null, message: 'Initial commit' }).id);
  }

  #commit({ tree, parent, message }) {
    const id = sha(`${this.id}|${this.commits.size + 1}|${message}`);
    const commit = { id, shortId: id.slice(0, 8), title: message, parent, createdAt: new Date().toISOString(), authorName: 'fake', tree };
    this.commits.set(id, commit);
    return commit;
  }

  resolve(ref) {
    if (this.branches.has(ref)) return this.branches.get(ref);
    if (this.commits.has(ref)) return ref;
    const byShort = [...this.commits.values()].find((c) => c.shortId === ref || c.id.startsWith(ref));
    return byShort?.id ?? null;
  }

  treeAt(ref) {
    const at = this.resolve(ref);
    return at ? this.commits.get(at).tree : null;
  }

  /** The text of a file at a ref, or undefined. */
  read(ref, path) {
    return this.treeAt(ref)?.get(path)?.toString('utf8');
  }

  /** `actions`: [{ action: 'create' | 'update' | 'delete', path, content, encoding }] */
  commit({ branch, actions, message }) {
    const head = this.branches.get(branch);
    if (!head) throw refusal(404, 'no such branch');
    const tree = new Map(this.commits.get(head).tree);
    for (const { action, path, content, encoding } of actions) {
      const bytes = Buffer.from(content ?? '', encoding === 'base64' ? 'base64' : 'utf8');
      if (action === 'create') {
        if (tree.has(path)) throw refusal(400, `${path} already exists`);
        tree.set(path, bytes);
      } else if (action === 'update') {
        if (!tree.has(path)) throw refusal(400, `${path} does not exist`);
        tree.set(path, bytes);
      } else if (action === 'delete') {
        if (!tree.delete(path)) throw refusal(400, `${path} does not exist`);
      } else throw refusal(400, `unknown action ${action}`);
    }
    const made = this.#commit({ tree, parent: head, message });
    this.branches.set(branch, made.id);
    return made;
  }

  createBranch(name, ref) {
    if (this.branches.has(name)) throw refusal(400, `The branch ${name} already exists`);
    const at = this.resolve(ref);
    if (!at) throw refusal(404, 'no such ref');
    this.branches.set(name, at);
  }

  #ancestors(at) {
    const seen = new Set();
    for (let sha1 = at; sha1; sha1 = this.commits.get(sha1).parent) seen.add(sha1);
    return seen;
  }

  /** What `to` has beyond `from`: its commits (newest first) and its files that differ from the merge base. */
  compare(from, to) {
    const [a, b] = [this.resolve(from), this.resolve(to)];
    if (!a || !b) throw refusal(404, 'no such ref');
    const inFrom = this.#ancestors(a);
    const commits = [];
    let base = null;
    for (let at = b; at; at = this.commits.get(at).parent) {
      if (inFrom.has(at)) { base = at; break; }
      commits.push(this.commits.get(at));
    }
    const before = base ? this.commits.get(base).tree : new Map();
    const after = this.commits.get(b).tree;
    const files = [];
    for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const [x, y] = [before.get(path), after.get(path)];
      if (x && y && x.equals(y)) continue;
      files.push({ oldPath: path, newPath: path, status: !x ? 'added' : !y ? 'deleted' : 'modified', additions: 0, deletions: 0, patch: `@@ ${path} @@\n${y ? `+${y.toString('utf8')}` : `-${x.toString('utf8')}`}` });
    }
    return { commits: commits.map(({ tree, ...rest }) => rest), files };
  }

  summary() {
    return { id: this.id, path: this.name, webUrl: this.webUrl, defaultBranch: this.defaultBranch, baseBranch: 'bigbang' };
  }
}

export const startGitRepos = () => {
  const state = { repos: new Map(), next: 1, calls: [], infra: false, hooksUnavailable: false };

  const git = {
    state,
    seedProject({ name, topics, defaultBranch } = {}) {
      const repo = new Repo({ id: state.next++, name, topics, defaultBranch });
      state.repos.set(repo.id, repo);
      return repo;
    },
    getProject: (id) => state.repos.get(Number(id)),
    reset() { state.repos.clear(); state.next = 1; state.calls = []; state.infra = false; state.hooksUnavailable = false; },
  };

  const router = express.Router({ mergeParams: true });
  const wrap = (fn) => (req, res) => {
    try {
      const repo = state.repos.get(Number(req.params.id));
      if (!repo) return res.status(404).json({ error: 'error_messages.line_not_found' });
      state.calls.push({ method: req.method, path: req.path, query: { ...req.query }, body: req.body });
      return fn(repo, req, res);
    } catch (error) {
      if (error?.status) return res.status(error.status).json(error.body);
      throw error;
    }
  };
  const mrJson = (repo, mr) => ({ number: mr.number, title: mr.title, description: mr.description ?? '', state: mr.state, sourceBranch: mr.sourceBranch, targetBranch: mr.targetBranch, webUrl: `${repo.webUrl}/mrs/${mr.number}`, hasConflicts: Boolean(mr.hasConflicts) });

  router.get('/', wrap((repo, req, res) => res.json(repo.summary())));
  router.get('/branches', wrap((repo, req, res) => res.json([...repo.branches.keys()])));
  router.post('/branches', wrap((repo, req, res) => { repo.createBranch(req.body.branch, req.body.ref); res.status(201).json({ branch: req.body.branch, ref: req.body.ref }); }));
  router.get('/branch', wrap((repo, req, res) => {
    const at = repo.branches.get(req.query.name);
    if (!at) return res.status(404).json({ error: 'no such branch' });
    const { tree, ...last } = repo.commits.get(at);
    return res.json({ name: req.query.name, lastCommit: last });
  }));
  router.get('/files', wrap((repo, req, res) => {
    const tree = repo.treeAt(req.query.ref);
    return tree ? res.json([...tree.keys()].sort()) : res.status(404).json({ error: 'no such ref' });
  }));
  router.get('/file', wrap((repo, req, res) => {
    const content = repo.treeAt(req.query.ref)?.get(req.query.path);
    if (!content) return res.status(404).json({ error: 'file_not_found' });
    return res.json({ path: req.query.path, content: content.toString('base64'), encoding: 'base64', revision: repo.resolve(req.query.ref) });
  }));
  router.get('/commits', wrap((repo, req, res) => {
    const out = [];
    for (let at = repo.resolve(req.query.ref); at && out.length < Number(req.query.perPage ?? 20); at = repo.commits.get(at).parent) {
      const { tree, ...rest } = repo.commits.get(at);
      out.push(rest);
    }
    res.json(out);
  }));
  router.post('/commits', wrap((repo, req, res) => { const { id } = repo.commit(req.body); res.status(201).json({ id }); }));
  router.get('/compare', wrap((repo, req, res) => res.json(repo.compare(req.query.from, req.query.to))));
  router.get('/archive', wrap(async (repo, req, res) => {
    const tree = repo.treeAt(req.query.ref);
    if (!tree) return res.status(404).json({ error: 'no such ref' });
    const zip = new JSZip();
    for (const [path, bytes] of tree) zip.file(path, bytes);
    return res.type('application/zip').send(await zip.generateAsync({ type: 'nodebuffer' }));
  }));
  router.post('/push-hook', wrap((repo, req, res) => {
    if (state.hooksUnavailable) return res.json({ status: 'unavailable' });
    repo.hooks += 1;
    return res.json({ status: repo.hooks === 1 ? 'created' : 'already_exists' });
  }));

  router.get('/mrs', wrap((repo, req, res) => {
    const items = [...repo.mergeRequests.values()].filter((mr) => (!req.query.state || req.query.state === 'all' || mr.state === req.query.state)
      && (!req.query.targetBranch || mr.targetBranch === req.query.targetBranch) && (!req.query.sourceBranch || mr.sourceBranch === req.query.sourceBranch));
    res.json({ items: items.map((mr) => mrJson(repo, mr)), page: 1, perPage: 100, hasMore: false });
  }));
  router.post('/mrs', wrap((repo, req, res) => {
    const mr = { number: repo.nextMr++, state: 'opened', ...req.body };
    repo.mergeRequests.set(mr.number, mr);
    res.status(201).json(mrJson(repo, mr));
  }));
  router.get('/mrs/:number', wrap((repo, req, res) => {
    const mr = repo.mergeRequests.get(Number(req.params.number));
    return mr ? res.json(mrJson(repo, mr)) : res.status(404).json({ error: 'no such merge request' });
  }));
  router.get('/mrs/:number/diff', wrap((repo, req, res) => {
    const mr = repo.mergeRequests.get(Number(req.params.number));
    return mr ? res.json(repo.compare(mr.targetBranch, mr.sourceBranch).files) : res.status(404).json({ error: 'no such merge request' });
  }));
  router.post('/mrs/:number/threads', wrap((repo, req, res) => {
    const mr = repo.mergeRequests.get(Number(req.params.number));
    if (!mr) return res.status(404).json({ error: 'no such merge request' });
    (mr.comments ??= []).push(req.body.body);
    return res.status(201).json({ id: mr.comments.length, comments: [{ body: req.body.body }] });
  }));
  router.post('/mrs/:number/merge', wrap((repo, req, res) => {
    const mr = repo.mergeRequests.get(Number(req.params.number));
    if (!mr) return res.status(404).json({ error: 'no such merge request' });
    if (mr.hasConflicts) return res.status(409).json({ merged: false, conflicts: true });
    mr.state = 'merged';
    return res.json({ merged: true });
  }));

  return { git, router };
};
