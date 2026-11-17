import { delimiterTable, delimitersFor, parseAnnotations } from '../shared/parser.js';
import { queryOf } from './core.js';

const extensionOf = (path) => String(path).split('/').pop().split('.').slice(1).pop()?.toLowerCase() ?? '';
const decode = (file) => (file.encoding === 'base64' || !file.encoding ? Buffer.from(file.content ?? '', 'base64') : Buffer.from(file.content ?? '', 'utf8'));

const inBatches = async (items, size, fn) => {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
};

/**
 * Keeps the index of annotations of a line's ref. `ensure` brings it up to date with the commit the ref points at: only the files whose
 * revision changed are read again. A push (or a save) makes it stale with `invalidate`; the next read rebuilds it.
 */
export const createIndexer = ({ models, core, settings }) => {
  const { Annotation, FileIndex, IndexState } = models;

  const commitOf = async (auth, lineId, ref) => {
    const branch = await core.get(auth, `/lines/${lineId}/repo/branch${queryOf({ name: ref })}`).catch(() => null);
    const last = branch?.lastCommit ?? branch?.commit
    return last?.id ?? last?.shortId ?? ref;
  };

  const CONFIG_PATH = 'src/platform/config.json';
  /** The delimiters the line's engine uses, by extension (its config.json at `ref`, the plugin's setting over it). */
  const delimitersOf = async (auth, lineId, ref) => {
    const file = await core.get(auth, `/lines/${lineId}/repo/file${queryOf({ path: CONFIG_PATH, ref })}`).catch(() => null);
    return delimiterTable(file ? decode(file).toString('utf8') : null, settings().delimiters);
  };

  const ensure = async ({ auth, lineId, ref, force = false }) => {
    const [info, commitSha] = await Promise.all([core.get(auth, `/lines/${lineId}/repo`), commitOf(auth, lineId, ref)]);
    const state = await IndexState.findOne({ lineId, ref });
    if (!force && state && state.commitSha === commitSha) return { commitSha, reused: true };

    const { maxFileKb, editableExtensions } = settings();
    const delimiters = await delimitersOf(auth, lineId, ref);
    const allowed = new Set((Array.isArray(editableExtensions) ? editableExtensions : String(editableExtensions).split(',')).map((e) => e.trim().toLowerCase()).filter(Boolean));
    const paths = (await core.get(auth, `/lines/${lineId}/repo/files${queryOf({ ref })}`)).filter((p) => allowed.has(extensionOf(p)));
    const known = new Map((await FileIndex.find({ lineId, ref }).lean()).map((row) => [row.path, row]));
    const present = new Set(paths);

    let reparsed = 0;
    await inBatches(paths, 8, async (path) => {
      const file = await core.get(auth, `/lines/${lineId}/repo/file${queryOf({ path, ref })}`).catch(() => null);
      if (!file) return;
      const bytes = decode(file);
      if (bytes.length > maxFileKb * 1024) return;
      const previous = known.get(path);
      if (previous && previous.blobSha === file.revision) return;
      const regions = parseAnnotations(bytes.toString('utf8'), { delimiters: delimitersFor(path, delimiters) });
      await Annotation.deleteMany({ lineId, ref, path });
      if (regions.length) {
        await Annotation.insertMany(regions.map((r) => ({
          lineId, ref, path, startLine: r.startLine, endLine: r.endLine, featureExpr: r.expression, features: r.features, source: 'parsed', commitSha,
        })));
      }
      await FileIndex.updateOne({ lineId, ref, path }, { $set: { blobSha: file.revision, annotationCount: regions.length } }, { upsert: true });
      reparsed += 1;
    });

    const gone = [...known.keys()].filter((p) => !present.has(p));
    if (gone.length) {
      await Annotation.deleteMany({ lineId, ref, path: { $in: gone } });
      await FileIndex.deleteMany({ lineId, ref, path: { $in: gone } });
    }
    await IndexState.updateOne({ lineId, ref }, { $set: { repositoryId: String(info.id), commitSha } }, { upsert: true });
    return { commitSha, reused: false, reparsed, removed: gone.length };
  };

  /** The repository (or one branch of it) changed outside the editor. */
  const invalidate = async ({ repositoryId, branch }) => IndexState.deleteMany({ repositoryId: String(repositoryId), ...(branch ? { ref: branch } : {}) });

  /** Forgets the whole index of a line (the collections can be emptied at any time: `ensure` makes them again). */
  const clear = async ({ lineId }) => Promise.all([Annotation, FileIndex, IndexState].map((m) => m.deleteMany({ lineId })));

  const byFeature = async ({ lineId, ref }) => {
    const rows = await Annotation.find({ lineId, ref }).sort({ path: 1, startLine: 1 }).lean();
    const out = {};
    for (const row of rows) {
      for (const feature of row.features.length ? row.features : ['(none)']) {
        (out[feature] ??= []).push({ path: row.path, startLine: row.startLine, endLine: row.endLine, expression: row.featureExpr });
      }
    }
    return out;
  };

  const ofFile = ({ lineId, ref, path }) => Annotation.find({ lineId, ref, path }).sort({ startLine: 1 }).lean()
    .then((rows) => rows.map((r) => ({ startLine: r.startLine, endLine: r.endLine, expression: r.featureExpr, features: r.features })));

  return { ensure, invalidate, clear, byFeature, ofFile, delimitersOf };
};
