import { Annotation, FileIndex, IndexState } from './models.js';
import { createCore, queryOf } from './core.js';
import { createIndexer } from './indexer.js';
import { annotateRange, delimitersFor, featureNames, lineaModelNames, parseAnnotations, removeAnnotation } from '../shared/parser.js';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[\w-]{1,64}$/;
const REF = /^(?!-)[\w./@~^-]{1,255}$/;
const safePath = (path) => typeof path === 'string' && path && path.length <= 1024 && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\0');

export default {
  async register(ctx) {
    const { requireAuth, asyncHandler } = ctx.services;
    const router = ctx.router();
    const baseUrl = () => ctx.settings().coreUrl || `http://127.0.0.1:${process.env.port ?? process.env.PORT ?? 3000}`;
    const core = createCore({ baseUrl });
    const indexer = createIndexer({ models: { Annotation, FileIndex, IndexState }, core, settings: () => ctx.settings() });

    // Everything runs as the person asking: their authorization goes on to LINEA's own API, which decides what they may read or write.
    const auth = (req) => {
      const value = req.headers.authorization;
      if (!value) throw bad('Authorization needed', 401);
      return value;
    };
    const lineOf = async (req) => {
      const lineId = req.params.id;
      if (!ID.test(lineId)) throw bad('Not a line id');
      const line = await core.get(auth(req), `/lines/${lineId}?brief=1`);
      // simple SPLs only: the others have models and modules this editor does not know
      if ((line.kind ?? 'plain') !== 'plain') throw bad('This editor is for simple SPLs', 409);
      return line;
    };
    const refOf = (value, line) => {
      const ref = value || line.defaultBranch || 'main';
      if (!REF.test(ref)) throw bad('Not a ref');
      return ref;
    };
    const route = (fn) => [requireAuth, asyncHandler(async (req, res) => {
      try { await fn(req, res); } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message, ...(error.body ? { detail: error.body } : {}) });
        throw error;
      }
    })];

    // the names of the features of the line's model (for the editor to suggest) and the index by feature
    router.get('/lines/:id/features', ...route(async (req, res) => {
      const line = await lineOf(req);
      const ref = refOf(req.query.ref, line);
      await indexer.ensure({ auth: auth(req), lineId: req.params.id, ref });
      // the model of the branch asked for (its file), else the line's own model, which LINEA gives as UVL
      const file = await core.get(auth(req), `/lines/${req.params.id}/repo/file${queryOf({ path: 'models/featuremodel.featuremodel', ref })}`).catch(() => null);
      let names = file ? lineaModelNames(Buffer.from(file.content ?? '', file.encoding === 'text' ? 'utf8' : 'base64').toString('utf8')) : [];
      if (!names.length) {
        const model = await core.get(auth(req), `/lines/${req.params.id}/model`).catch(() => null);
        names = featureNames(typeof model === 'string' ? model : (model?.uvl ?? model?.text ?? ''));
      }
      res.json({ ref, names, delimiters: await indexer.delimitersOf(auth(req), req.params.id, ref), annotations: await indexer.byFeature({ lineId: req.params.id, ref }) });
    }));

    router.get('/lines/:id/annotations', ...route(async (req, res) => {
      const line = await lineOf(req);
      const ref = refOf(req.query.ref, line);
      if (!safePath(req.query.path)) throw bad('Not a path');
      await indexer.ensure({ auth: auth(req), lineId: req.params.id, ref });
      res.json({ ref, path: req.query.path, regions: await indexer.ofFile({ lineId: req.params.id, ref, path: req.query.path }) });
    }));

    // the regions of a text that is not committed (what the editor holds)
    router.post('/lines/:id/annotations/parse', ...route(async (req, res) => {
      const line = await lineOf(req);
      if (!safePath(req.body?.path) || typeof req.body?.content !== 'string') throw bad('path and content are needed');
      const table = await indexer.delimitersOf(auth(req), req.params.id, refOf(req.body.ref, line));
      res.json({ regions: parseAnnotations(req.body.content, { delimiters: delimitersFor(req.body.path, table) }) });
    }));

    // annotate or un-annotate a range of lines: the new text comes back, the editor commits it with the rest (the repository holds it)
    router.post('/lines/:id/annotate', ...route(async (req, res) => {
      const line = await lineOf(req);
      const { path, content, startLine, endLine, feature, removeAt } = req.body ?? {};
      if (!safePath(path) || typeof content !== 'string' || content.length > 8 * 1024 * 1024) throw bad('path and content are needed');
      const delimiters = delimitersFor(path, await indexer.delimitersOf(auth(req), req.params.id, refOf(req.body.ref, line)));
      const text = removeAt !== undefined
        ? removeAnnotation(content, { line: Number(removeAt), delimiters })
        : annotateRange(content, { startLine: Number(startLine), endLine: Number(endLine), feature, delimiters });
      res.json({ content: text, regions: parseAnnotations(text, { delimiters }) });
    }));

    router.post('/lines/:id/reindex', ...route(async (req, res) => {
      const line = await lineOf(req);
      const ref = refOf(req.body?.ref, line);
      res.json({ ref, ...(await indexer.ensure({ auth: auth(req), lineId: req.params.id, ref, force: Boolean(req.body?.force) })) });
    }));

    // Try a derivation: LINEA's engine does it (and makes nothing); `files` are changes not committed yet
    router.post('/lines/:id/try', ...route(async (req, res) => {
      const line = await lineOf(req);
      const { features, files } = req.body ?? {};
      if (!Array.isArray(features) || !features.every((f) => typeof f === 'string')) throw bad('features must be a list of names');
      const overrides = (Array.isArray(files) ? files : []).map((file) => {
        if (!safePath(file?.path) || !['create', 'update', 'delete'].includes(file?.action)) throw bad('Not a change');
        return { path: file.path, action: file.action, ...(file.action === 'delete' ? {} : { content: String(file.content ?? '') }) };
      });
      // `include`: paths of the derived product whose content comes back too (the output of one file)
      const include = Array.isArray(req.body?.include) ? req.body.include : [];
      if (include.length > 20 || !include.every(safePath)) throw bad('include must be a short list of paths');
      const ref = refOf(req.body?.ref, line);
      // `spec`: a sample of the product's spec (what the templates see as `data`)
      const spec = req.body?.spec;
      if (spec !== undefined && spec !== null && (typeof spec !== 'object' || Array.isArray(spec) || JSON.stringify(spec).length > 1024 * 1024)) throw bad('spec must be an object');
      res.json(await core.post(auth(req), `/lines/${req.params.id}/derive-trial`, { features, lineRef: ref, overrides, include, ...(spec ? { spec } : {}), ...(req.body?.zip === true ? { zip: true } : {}) }));
    }));

    // somebody pushed outside the editor: what was indexed of that repository (branch) is stale
    ctx.events.on('git:pushed', async ({ repositoryId, branch }) => {
      if (repositoryId !== undefined) await indexer.invalidate({ repositoryId, branch });
    });

  },
};
