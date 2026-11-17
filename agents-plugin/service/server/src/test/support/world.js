import mongoose from 'mongoose';
import { Container } from 'typedi';
import User from '../../model/entities/user.js';
import { startFakeLinea, SERVICE_KEY } from './fakeLinea.js';
import { FEATURE_MODEL_PATH } from '../../linea/featureModelFormat.js';

let fake = null;
let previousUrl;
let previousKey;

export async function setupFakeLinea() {
  fake = await startFakeLinea();
  previousUrl = process.env.LINEA_API_URL;
  process.env.LINEA_API_URL = fake.url;
  previousKey = process.env.AGENTS_SERVICE_KEY;
  process.env.AGENTS_SERVICE_KEY = SERVICE_KEY;
}

export function resetFakeLinea() {
  fake?.reset();
}

export async function teardownFakeLinea() {
  await fake?.close();
  fake = null;
  if (previousUrl === undefined) delete process.env.LINEA_API_URL;
  else process.env.LINEA_API_URL = previousUrl;
  if (previousKey === undefined) delete process.env.AGENTS_SERVICE_KEY;
  else process.env.AGENTS_SERVICE_KEY = previousKey;
}

export function fakeLinea() {
  if (!fake) throw new Error('fakeLinea() called before setupFakeLinea() — check hook order.');
  return fake;
}

export const noFeatureSpec = (name) => ({
  basicData: { name, version: '0.0.0', database: {}, languages: ['en'] },
  dataModel: { cells: [] },
  features: [],
  statics: [],
});

let counter = 0;
const unique = (prefix) => `${prefix}-${Date.now()}-${++counter}`;

/** A person LINEA says is using agents. */
export const createUser = (prefix = 'user', extra = {}) =>
  new User({ username: unique(prefix), admin: true, ...extra }).save();

/** A line of LINEA, with its repository in the fake git host. */
export const createLine = ({ user, name, version = '0.0.0', uvl }) => {
  const project = fakeLinea().git.seedProject({ name, topics: ['line'] });
  // a line keeps its feature model in its repository: what agents reads from a branch
  project.commit({ branch: project.defaultBranch, actions: [{ action: 'create', path: FEATURE_MODEL_PATH, content: 'featuremodel Root\nfeature Root\n' }], message: 'Add the feature model' });
  const line = { _id: String(new mongoose.Types.ObjectId()), name, version, description: 'x', repoId: project.id, ownerId: String(user._id), uvl };
  fakeLinea().state.lines.set(line._id, line);
  return line;
};

/** A product of a line, with its repository in the fake git host. `specInGit` is the spec LINEA reads there (default: the stored one). */
export const createProduct = ({ line, spec, specInGit }) => {
  const project = fakeLinea().git.seedProject({ name: spec.basicData.name, topics: ['product'] });
  const product = {
    _id: String(new mongoose.Types.ObjectId()), lineId: line._id, spec,
    repo: { id: project.id, webUrl: project.webUrl },
    specInGit: specInGit === undefined ? spec : specInGit,
  };
  fakeLinea().state.products.set(product._id, product);
  return product;
};

export { Container };
