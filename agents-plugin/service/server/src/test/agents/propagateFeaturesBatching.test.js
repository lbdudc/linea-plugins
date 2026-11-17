import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import changesetAgentDefinition from '../../agents/definitions/changesetAgent.js';
import { runAs } from '../../linea/actingUser.js';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, createProduct, noFeatureSpec, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';

const TARGET_COUNT = 7;

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

// What agents asked LINEA to save as a product's selection (LINEA is the one that writes the spec).
const savedSelections = () => fakeLinea().state.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/selection'));

const propagate = (user, line, products, newFeatures) => {
  const propagateStep = changesetAgentDefinition.steps.find((s) => s.name === 'propagate-features');
  const plan = {
    newFeatures,
    cascade: products.map((p) => ({ productId: String(p._id), name: p.spec.basicData.name, action: 'regen' })),
  };
  const approvedProposal = { kind: 'plan_approval', decision: 'approved', body: { decisionMeta: { overrides: {} } } };
  const ctx = {
    lineId: String(line._id),
    userId: user._id,
    run: { _id: 'fake-run-id' },
    getStepOutput: (name) => (name === 'plan' ? plan : undefined),
    getProposals: () => [approvedProposal],
  };
  return runAs(user._id, () => propagateStep.run(ctx));
};

test('propagate-features processes ALL targets across multiple batches, not just the first chunk', async () => {
  const user = await createUser('propagate-batch');
  const line = createLine({ user, name: 'PropagateBatchLine' });
  const products = [];
  for (let i = 0; i < TARGET_COUNT; i++) products.push(createProduct({ line, spec: noFeatureSpec(`BatchTarget${i}`) }));

  const result = await propagate(user, line, products, ['BatchedFeature']);

  expect(result.output.touched).toBe(TARGET_COUNT);
  expect(savedSelections()).toHaveLength(TARGET_COUNT);
  for (const product of products) {
    expect(fakeLinea().state.products.get(product._id).specInGit.features).toContain('BatchedFeature');
  }
}, 30000);

test('propagate-features merges onto the CURRENT spec in git — a feature added by hand there survives the cascade', async () => {
  const user = await createUser('propagate-handedit');
  const line = createLine({ user, name: 'PropagateHandEditLine' });
  const product = createProduct({
    line, spec: noFeatureSpec('HandEditTarget'),
    specInGit: { ...noFeatureSpec('HandEditTarget'), features: ['HandEditedFeature'] },
  });

  await propagate(user, line, [product], ['CascadedFeature']);

  const [saved] = savedSelections();
  expect(saved.path).toBe(`/api/products/${product._id}/selection`);
  expect(saved.body.features).toEqual(['HandEditedFeature', 'CascadedFeature']);
});

test('propagate-features saves nothing for a product that already has the feature', async () => {
  const user = await createUser('propagate-noop');
  const line = createLine({ user, name: 'PropagateNoopLine' });
  const product = createProduct({ line, spec: noFeatureSpec('AlreadyHas'), specInGit: { ...noFeatureSpec('AlreadyHas'), features: ['Existing'] } });

  const result = await propagate(user, line, [product], ['Existing']);

  expect(result.output.touched).toBe(0);
  expect(savedSelections()).toHaveLength(0);
});
