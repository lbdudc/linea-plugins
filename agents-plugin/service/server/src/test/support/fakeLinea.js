import express from 'express';
import JSZip from 'jszip';
import { startGitRepos } from './gitRepos.js';

/**
 * An in-memory LINEA for tests: the endpoints agents calls (see src/linea and src/model), answering as the real ones do, from a state
 * the test fills. Anything a test needs to inject (the git host being down, a merge that conflicts) is a field of `state`.
 *
 * What the real LINEA does and this does not: check who may see what (every call is accepted as long as it presents the service key
 * and says who it acts for), and read the git host (the spec "in git" of a product is `product.specInGit`; the repositories are
 * `fakeLinea().git`, in memory).
 */
/** The key agents and this fake share in tests (AGENTS_SERVICE_KEY). */
export const SERVICE_KEY = 'test-service-key';

export const startFakeLinea = async () => {
  const { git, router: repos } = startGitRepos();
  const state = {
    lines: new Map(),
    products: new Map(),
    logs: new Map(),
    // what a call did, in order: { method, path, query, body, actAs }
    // what agents passed on for people's sockets: { username, event, payload }
    relayed: [],
    requests: [],
    // the git host cannot be read: specs come from the stored copy, with the reason
    infra: false,
    mergeResult: { merged: true, conflicts: false, mrIid: 1 },
    generateResult: { conflicts: false, stage: null },
    nextBranch: 1,
    // the files LINEA derives a product to (`POST /api/products/:id/zip`), and how long that takes
    derived: { 'derived.txt': 'derived' },
    deriveDelayMs: 0,
  };

  const reset = () => {
    git.reset();
    state.lines.clear();
    state.products.clear();
    state.logs.clear();
    state.requests = [];
    state.relayed = [];
    state.infra = false;
    state.mergeResult = { merged: true, conflicts: false, mrIid: 1 };
    state.generateResult = { conflicts: false, stage: null };
    state.nextBranch = 1;
    state.derived = { 'derived.txt': 'derived' };
    state.deriveDelayMs = 0;
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const [scheme, key] = (req.headers.authorization ?? '').split(' ');
    const actAs = req.headers['x-act-as'];
    if (scheme !== 'Service' || key !== SERVICE_KEY || !actAs) return res.status(401).json({ error: 'error_messages.incorrect_credentials' });
    state.requests.push({ method: req.method, path: req.path, query: { ...req.query }, body: req.body, actAs });
    req.actAs = actAs;
    next();
  });

  // the code of the repositories, whatever the host
  app.use('/api/repos/:id', repos);
  // LINEA puts these on the socket of the person
  app.post('/api/plugins/agents-plugin/relay', (req, res) => {
    state.relayed.push({ username: req.actAs, event: req.body.event, payload: req.body.payload });
    res.status(204).end();
  });

  const notFound = (res) => res.status(404).json({ error: 'error_messages.not_found' });
  // a feature model the engine accepts (an abstract root with nothing under it is not one)
  const DEFAULT_UVL = 'features\n    Root\n        optional\n            Extra\n';
  const plain = (doc) => JSON.parse(JSON.stringify(doc));
  const productById = (id) => state.products.get(String(id));
  const productByProject = (projectId) => [...state.products.values()].find((p) => p.repo.id === Number(projectId));
  // the spec of a product as the git host has it, or as LINEA stored it when the host cannot be read
  const specOf = (product) => (state.infra || !product.specInGit ? { spec: product.spec, source: 'mongo', reason: state.infra ? 'infra' : 'absent' } : { spec: product.specInGit, source: 'repo', reason: null });

  app.get('/api/lines/enrolled', (req, res) => res.json([...state.lines.values()].map(plain)));
  app.get('/api/lines/:id/products', (req, res) => {
    if (!state.lines.has(req.params.id)) return notFound(res);
    if (state.infra && req.query.cut === '1') return res.status(503).json({ error: 'error_messages.product_spec_unavailable' });
    const products = [...state.products.values()].filter((p) => String(p.lineId) === req.params.id);
    res.json(products.map((p) => plain({ ...p, spec: req.query.spec === '1' ? specOf(p).spec : p.spec, specInGit: undefined })));
  });
  app.get('/api/lines/:id/model', (req, res) => {
    const line = state.lines.get(req.params.id);
    if (!line) return notFound(res);
    res.json({ uvl: line.uvl ?? DEFAULT_UVL, text: line.modelText ?? 'featuremodel Root\nfeature Root\n', version: line.version, file: 'models/featuremodel.featuremodel' });
  });
  app.put('/api/lines/:id/model', (req, res) => (state.lines.has(req.params.id) ? res.status(200).json({ version: '1.1.0' }) : notFound(res)));
  app.post('/api/lines/:id/model/from-uvl', (req, res) => res.json({ text: `featuremodel from-uvl\n${req.body.uvl}` }));
  // text of the line's feature model → UVL. The fake keeps no metamodel: a model text ("featuremodel …") is answered with the line's UVL,
  // any other text is echoed back, so a test can check how the bytes of a file were decoded.
  app.post('/api/lines/:id/model/preview', (req, res) => {
    const line = state.lines.get(req.params.id);
    if (!line) return notFound(res);
    const content = req.body.content ?? '';
    res.json({ ok: true, diagnostics: [], uvl: content.startsWith('featuremodel') ? (line.uvl ?? DEFAULT_UVL) : content });
  });
  app.post('/api/lines/:id/plan-branch/commits', (req, res) => {
    if (!state.lines.has(req.params.id)) return notFound(res);
    res.json({ branch: req.body.branch ?? `plan/change-${state.nextBranch++}` });
  });
  app.post('/api/lines/:id/plan-branch/merge', (req, res) => res.json(state.mergeResult));
  app.get('/api/lines/:id', (req, res) => {
    const line = state.lines.get(req.params.id);
    return line ? res.json(plain(line)) : notFound(res);
  });

  app.get('/api/products/enrolled', (req, res) => res.json([...state.products.values()].map((p) => plain({ _id: p._id, name: p.spec.basicData.name, version: p.spec.basicData.version, lineId: p.lineId, repo: p.repo }))));
  app.get('/api/products/by-git-project/:projectId', (req, res) => {
    const product = productByProject(req.params.projectId);
    if (!product) return notFound(res);
    if (req.query.spec !== '1') return res.json({ ...plain(product), specInGit: undefined, specSource: null, specReason: null });
    const { spec, source, reason } = specOf(product);
    res.json({ ...plain(product), spec: plain(spec), specInGit: undefined, specSource: source, specReason: reason });
  });
  app.put('/api/products/:id/selection', (req, res) => {
    const product = productById(req.params.id);
    if (!product) return notFound(res);
    // LINEA completes the selection with the root; what it stores is the features the selection comes to
    const features = [...new Set(req.body.features)];
    product.specInGit = { ...(product.specInGit ?? product.spec), features };
    product.spec = { ...product.spec, features };
    res.json({ ok: true, features });
  });
  app.post('/api/products/:id/zip', async (req, res) => {
    if (!productById(req.params.id)) return notFound(res);
    await new Promise((resolve) => setTimeout(resolve, state.deriveDelayMs));
    const zip = new JSZip();
    for (const [name, content] of Object.entries(state.derived)) zip.file(name, content);
    return res.status(200).send(await zip.generateAsync({ type: 'base64' }));
  });
  app.post('/api/products/:id/generate', (req, res) => (productById(req.params.id) ? res.json({ ...state.generateResult, version: '1.0.1' }) : notFound(res)));
  app.get('/api/products/:id', (req, res) => {
    const product = productById(req.params.id);
    return product ? res.json({ ...plain(product), specInGit: undefined }) : notFound(res);
  });
  app.get('/api/products/:id/health', (req, res) => (productById(req.params.id) ? res.json({ valid: true, features: [] }) : notFound(res)));
  app.get('/api/products/:id/conflicts', (req, res) => (productById(req.params.id) ? res.json({ conflictingMRs: 0 }) : notFound(res)));
  app.get('/api/logs/metrics', (req, res) => res.json({ total: state.requests.length }));
  app.get('/api/logs/:id/:version', (req, res) => res.json(state.logs.get(req.params.id) ?? []));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    git,
    reset,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
