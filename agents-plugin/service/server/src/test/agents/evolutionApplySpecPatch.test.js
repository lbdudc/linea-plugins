import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { applySpecPatch } from '../../agents/tools/evolution.js';
import { ProductSpecUnavailableError } from '../../model/services/ProductSpecService.js';
import { runAs } from '../../linea/actingUser.js';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, createProduct, noFeatureSpec, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

const calls = () => fakeLinea().state.requests.map((r) => `${r.method} ${r.path}${r.query.spec ? '?spec' : ''}`);

test('applySpecPatch checks the spec LINEA reads from git before patching, and has LINEA save the selection', async () => {
  const user = await createUser('evolution-patch');
  const line = createLine({ user, name: 'EvolutionPatchLine' });
  const product = createProduct({ line, spec: noFeatureSpec('EvolutionPatchTarget') });

  await runAs(user._id, () => applySpecPatch({ productId: String(product._id), features: ['Added'], userId: user._id }));

  const requests = calls();
  expect(requests.indexOf(`GET /api/products/by-git-project/${product.repo.id}?spec`)).toBeGreaterThanOrEqual(0);
  expect(requests.indexOf(`GET /api/products/by-git-project/${product.repo.id}?spec`)).toBeLessThan(requests.indexOf(`PUT /api/products/${product._id}/selection`));
  expect(fakeLinea().state.products.get(product._id).specInGit.features).toEqual(['Added']);
});

test('applySpecPatch aborts with ProductSpecUnavailableError when LINEA cannot read the spec in git, instead of saving over a stale one', async () => {
  const user = await createUser('evolution-infra');
  const line = createLine({ user, name: 'EvolutionInfraLine' });
  const product = createProduct({ line, spec: noFeatureSpec('EvolutionInfraTarget') });
  fakeLinea().state.infra = true;

  const thrown = await runAs(user._id, () => applySpecPatch({ productId: String(product._id), features: ['ShouldNotBeWritten'], userId: user._id })).catch((e) => e);

  expect(thrown).toBeInstanceOf(ProductSpecUnavailableError);
  expect(calls().some((c) => c.startsWith('PUT'))).toBe(false);
  expect(fakeLinea().state.products.get(product._id).specInGit.features).toEqual([]);
});
