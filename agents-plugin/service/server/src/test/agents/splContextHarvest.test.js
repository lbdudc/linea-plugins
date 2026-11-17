import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, fakeLinea, setupFakeLinea, resetFakeLinea, teardownFakeLinea } from '../support/world.js';
import { FEATURE_MODEL_PATH } from '../../linea/featureModelFormat.js';
import { loadFeatureModel, loadFeatureModelFromBranch } from '../../agents/tools/splContext.js';
import { readLineModel } from '../../agents/tools/harvest.js';
import { parseFeatureModel } from '../../linea/featureModel.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

const ACCENTED_UVL = 'features\n\tGEMA_SPL\n\t\tmandatory\n\t\t\t"Configuración"\n';

// What the fake LINEA's `model/preview` answers for a model text is that same text as UVL, so what comes out is what the repository's bytes
// decoded to: a wrong decoding (latin1 for utf8) shows as "Ã³".
const lineWithModelOn = async (branch) => {
  const user = await createUser('splctx');
  const line = createLine({ user, name: `SplCtxLine${Math.floor(Math.random() * 1e6)}`, uvl: ACCENTED_UVL });
  const project = fakeLinea().git.getProject(line.repoId);
  if (branch !== 'main') project.branches.set(branch, project.branches.get('main'));
  project.commit({ branch, actions: [{ action: 'update', path: FEATURE_MODEL_PATH, content: ACCENTED_UVL }], message: 'accented model' });
  return { user, line };
};

test('splContext.loadFeatureModel reads the model LINEA gives as UVL and keeps its accents (splContext.js: buildFeatureModel)', async () => {
  const { user, line } = await lineWithModelOn('main');

  const { modelStr } = await loadFeatureModel({ lineId: String(line._id), userId: user._id });

  expect(modelStr).toContain('Configuración');
  expect(modelStr).not.toContain('Ã³');
});

test('splContext.loadFeatureModelFromBranch decodes UTF-8 accents of the file on the branch (splContext.js: loadFeatureModelFromBranch)', async () => {
  const { user, line } = await lineWithModelOn('plan/some-branch');

  const { modelStr, type } = await loadFeatureModelFromBranch({ lineId: String(line._id), userId: user._id, branch: 'plan/some-branch' });

  expect(type).toBe('UVL');
  expect(modelStr).toContain('Configuración');
  expect(modelStr).not.toContain('Ã³');
});

test('harvest.readLineModel decodes UTF-8 accents of the line\'s feature model file (harvest.js: readLineModel)', async () => {
  const { user, line } = await lineWithModelOn('main');

  const model = await readLineModel({ lineProjectId: line.repoId, lineId: String(line._id), userId: String(user._id) });

  expect(model.type).toBe('UVL');
  expect(model.path).toBe(FEATURE_MODEL_PATH);
  expect(model.content).toContain('Configuración');
  expect(model.content).not.toContain('Ã³');
});

test('splContext.loadFeatureModel gives the model as UVL source (modelStr), not the parsed object\'s own text', async () => {
  const { user, line } = await lineWithModelOn('main');

  const { modelStr, model } = await loadFeatureModel({ lineId: String(line._id), userId: user._id });

  expect(model).toBeTruthy();
  expect(modelStr).toMatch(/^features\b/m);
  expect(() => parseFeatureModel({ content: modelStr, type: 'UVL' })).not.toThrow();
});
