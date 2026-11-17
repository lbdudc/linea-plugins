import mongoose from 'mongoose';

// The plugin's own collections (prefix `splCodeEditor_`). They are an index of the repository, which stays the source of truth: dropping
// them and asking for the index again gives the same annotations.
const define = (name, collection, fields, indexes) => {
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema(fields, { timestamps: true, collection });
  for (const index of indexes) schema.index(index);
  return mongoose.model(name, schema);
};

export const Annotation = define('SplCodeEditorAnnotation', 'splCodeEditor_annotations', {
  lineId: { type: String, required: true },
  ref: { type: String, required: true },
  path: { type: String, required: true },
  startLine: { type: Number, required: true },
  endLine: { type: Number, required: true },
  featureExpr: { type: String, required: true },
  features: { type: [String], default: [] },
  source: { type: String, enum: ['parsed', 'manual'], default: 'parsed' },
  commitSha: { type: String },
}, [{ lineId: 1, ref: 1, path: 1 }, { lineId: 1, ref: 1, features: 1 }]);

export const FileIndex = define('SplCodeEditorFileIndex', 'splCodeEditor_fileIndex', {
  lineId: { type: String, required: true },
  ref: { type: String, required: true },
  path: { type: String, required: true },
  blobSha: { type: String },
  annotationCount: { type: Number, default: 0 },
}, [{ lineId: 1, ref: 1, path: 1 }]);

// which commit of a ref the index was made from, and the repository it belongs to (a push event names the repository only)
export const IndexState = define('SplCodeEditorIndexState', 'splCodeEditor_indexState', {
  lineId: { type: String, required: true },
  ref: { type: String, required: true },
  repositoryId: { type: String },
  commitSha: { type: String },
}, [{ lineId: 1, ref: 1 }, { repositoryId: 1 }]);
