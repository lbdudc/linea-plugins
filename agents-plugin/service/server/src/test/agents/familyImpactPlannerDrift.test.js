import { vi, test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { runAs } from '../../linea/actingUser.js';
import { setup, clear, teardown } from '../setup.js';
import { createUser, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';

vi.mock('../../agents/tools/fmEditClass.js', () => ({
  classifyFmEdit: () => ({ editClass: 'refactoring', breaking: [], fixing: [], unaffected: [], invalidOnBoth: [] }),
}));

vi.mock('../../agents/tools/git.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    productAccess: vi.fn(async ({ productId }) => ({
      projectId: Number(driftFixtures[productId]?.projectId ?? 0),
    })),
  };
});

vi.mock('../../linea/repo.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    compareBranches: vi.fn(async ({ id }) => {
      const entry = Object.values(driftFixtures).find((f) => f.projectId === id);
      return { files: entry?.files ?? [], commits: entry?.files?.length ? [{ shortId: 'c1' }] : [] };
    }),
  };
});

let driftFixtures = {};

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

test('a product whose only main-vs-bigbang diff is .linea/spec.json is NOT flagged as drifted', async () => {
  const { default: FamilyImpactPlanner } = await import('../../agents/changeset/FamilyImpactPlanner.js');
  const planner = Container.get(FamilyImpactPlanner);

  const user = await createUser('drift-spec-only');
  // LINEA's products: they have no spec file in git yet, so the stored spec is what is read
  const line = { _id: 'drift-line', name: 'DriftSpecOnlyLine', version: '0.0.0', repoId: 1, ownerId: String(user._id) };
  fakeLinea().state.lines.set(line._id, line);
  const productOf = (name, projectId) => {
    const product = { _id: `drift-${projectId}`, lineId: line._id, spec: { basicData: { name, version: '0.1.0' }, features: [] }, specInGit: null };
    fakeLinea().state.products.set(product._id, product);
    return product;
  };
  const specOnlyProduct = productOf('SpecOnlyDriftProduct', 501);
  const cleanProduct = productOf('CleanProduct', 502);
  const realDriftProduct = productOf('RealDriftProduct', 503);

  driftFixtures = {
    [String(specOnlyProduct._id)]: { projectId: 501, files: [{ newPath: '.linea/spec.json', status: 'modified', patch: '...' }] },
    [String(cleanProduct._id)]: { projectId: 502, files: [] },
    [String(realDriftProduct._id)]: { projectId: 503, files: [{ newPath: 'src/platform/model.uvl', status: 'modified', patch: '...' }] },
  };

  const result = await runAs(user._id, () => planner.plan({
    lineId: String(line._id), userId: user._id, line,
    currentModel: null, proposedModel: null, proposedModelStr: '', origin: 'test',
  }));

  const byName = Object.fromEntries(result.cascade.map((c) => [c.name, c]));
  expect(byName.SpecOnlyDriftProduct.action).toBe('skip');
  expect(byName.SpecOnlyDriftProduct.likely_conflict).toBe(false);
  expect(byName.CleanProduct.action).toBe('skip');
  expect(byName.CleanProduct.likely_conflict).toBe(false);
  expect(byName.RealDriftProduct.action).toBe('regen');
  expect(byName.RealDriftProduct.likely_conflict).toBe(true);
});
