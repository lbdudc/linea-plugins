import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import changesetAgentDefinition from '../../agents/definitions/changesetAgent.js';
import { runAs } from '../../linea/actingUser.js';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, createProduct, noFeatureSpec, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

const savedSelections = () => fakeLinea().state.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/selection'));

const runPropagate = (user, plan) => {
  const propagateStep = changesetAgentDefinition.steps.find((s) => s.name === 'propagate-features');
  return runAs(user._id, () => propagateStep.run({
    lineId: plan.lineId, userId: user._id, run: { _id: 'fake-run-id' },
    getStepOutput: (name) => (name === 'plan' ? plan : undefined),
    getProposals: () => [{ kind: 'plan_approval', decision: 'approved', body: { decisionMeta: { overrides: {} } } }],
  }));
};

test('propagate-features cuts a product when LINEA cannot read its spec (infra) — nothing is saved, rest of the batch unaffected', async () => {
  const user = await createUser('propagate-infra');
  const line = createLine({ user, name: 'PropagateInfraLine' });
  const brokenProduct = createProduct({ line, spec: noFeatureSpec('InfraBrokenTarget') });
  const healthyProduct = createProduct({ line, spec: noFeatureSpec('InfraHealthyTarget') });
  const plan = {
    lineId: String(line._id),
    newFeatures: ['NewFeatureX'],
    cascade: [
      { productId: String(brokenProduct._id), name: 'InfraBrokenTarget', action: 'regen' },
      { productId: String(healthyProduct._id), name: 'InfraHealthyTarget', action: 'regen' },
    ],
  };

  fakeLinea().state.infra = true;
  const result = await runPropagate(user, plan);

  expect(result.output.touched).toBe(0);
  for (const entry of result.output.perProduct) {
    expect(entry.added).toEqual([]);
    expect(entry.error).toMatch(/infraestructura/);
  }
  expect(savedSelections()).toHaveLength(0);
}, 30000);

test('propagate-features detects a feature missing in git even when LINEA\'s stored copy says it is already there — and keeps what git has', async () => {
  const user = await createUser('propagate-stale');
  const line = createLine({ user, name: 'PropagateStaleLine' });
  const product = createProduct({
    line,
    spec: { ...noFeatureSpec('StaleStoredTarget'), features: ['StaleFeature'] },
    specInGit: { ...noFeatureSpec('StaleStoredTarget'), features: ['HandEditedFeature'] },
  });
  const plan = {
    lineId: String(line._id),
    newFeatures: ['StaleFeature'],
    cascade: [{ productId: String(product._id), name: 'StaleStoredTarget', action: 'regen' }],
  };

  const result = await runPropagate(user, plan);

  expect(result.output.touched).toBe(1);
  expect(result.output.perProduct[0].added).toContain('StaleFeature');
  expect(savedSelections()[0].body.features).toEqual(['HandEditedFeature', 'StaleFeature']);
});
