import { test, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { runAs } from '../../linea/actingUser.js';
import FamilyImpactPlanner from '../../agents/changeset/FamilyImpactPlanner.js';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, createProduct, setupFakeLinea, resetFakeLinea, teardownFakeLinea } from '../support/world.js';

vi.mock('../../agents/tools/fmEditClass.js', () => ({
  classifyFmEdit: (args) => {
    globalThis.__lastClassifyFmEditProducts = args.products;
    return { editClass: 'refactoring', breaking: [], fixing: [], unaffected: [], invalidOnBoth: [] };
  },
}));

const PRODUCT_COUNT = 15;

const specFor = (name, features) => ({
  basicData: { name, version: '0.0.0', database: {}, languages: ['en'] },
  dataModel: { cells: [] },
  features,
  statics: [],
});

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

test(`plan() reads ${PRODUCT_COUNT} products' specs from the git host within the 30s step budget`, async () => {
  const planner = Container.get(FamilyImpactPlanner);

  const user = await createUser('planner-budget');
  const line = createLine({ user, name: 'PlannerBudgetLine' });

  // every other product has a feature in git that LINEA's stored copy of its spec does not have
  const handEditedIds = new Set();
  const products = [];
  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const handEdited = i % 2 === 0;
    const product = createProduct({
      line, spec: specFor(`BudgetProduct${i}`, []),
      specInGit: specFor(`BudgetProduct${i}`, handEdited ? ['HandEditedInGit'] : []),
    });
    if (handEdited) handEditedIds.add(String(product._id));
    products.push(product);
  }

  const startedAt = Date.now();
  await runAs(user._id, () => planner.plan({
    lineId: String(line._id), userId: user._id, line,
    currentModel: null, proposedModel: null, proposedModelStr: '', origin: 'test',
  }));
  const elapsedMs = Date.now() - startedAt;

  expect(elapsedMs).toBeLessThan(15_000);

  const seen = globalThis.__lastClassifyFmEditProducts;
  expect(seen).toBeDefined();
  expect(seen.length).toBe(PRODUCT_COUNT);
  const byId = Object.fromEntries(seen.map((p) => [String(p._id), p]));
  for (const id of handEditedIds) {
    expect(byId[id].spec.features).toContain('HandEditedInGit');
  }
  const untouchedProduct = seen.find((p) => !handEditedIds.has(String(p._id)));
  expect(untouchedProduct.spec.features).toEqual([]);
}, 30000);
