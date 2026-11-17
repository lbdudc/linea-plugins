import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { ProductSpecUnavailableError } from '../../model/services/ProductSpecService.js';
import PlaygroundService from '../../agents/playground/PlaygroundService.js';
import { setup, clear, teardown } from '../setup.js';
import { runAs } from '../../linea/actingUser.js';
import { createUser, createLine, createProduct, noFeatureSpec, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

test('PlaygroundService#prepareWorkspace (via generateDownloadZip): cutOnInfra aborts BEFORE deriving any code', async () => {
  const playgroundService = Container.get(PlaygroundService);

  const user = await createUser('playground-derive-cut');
  const line = createLine({ user, name: 'PlaygroundDeriveCutLine' });
  const product = createProduct({ line, spec: noFeatureSpec('PlaygroundDeriveCutProduct') });

  fakeLinea().state.infra = true;
  await expect(runAs(user._id, () =>
    playgroundService.generateBranchDownloadZip({
      userId: user._id, productId: String(product._id), lineBranch: 'main', branch: 'main', featureSelection: [],
    })
  )).rejects.toBeInstanceOf(ProductSpecUnavailableError);
});

test('PlaygroundService#testFileEdits: cutOnInfra aborts BEFORE resolving a test verdict — never silently returns noTestCommand/passed', async () => {
  const playgroundService = Container.get(PlaygroundService);

  const user = await createUser('playground-test-cut');
  const line = createLine({ user, name: 'PlaygroundTestCutLine' });
  const product = createProduct({ line, spec: noFeatureSpec('PlaygroundTestCutProduct') });

  fakeLinea().state.infra = true;
  await expect(runAs(user._id, () =>
    playgroundService.testFileEdits({ userId: user._id, productId: String(product._id), branch: 'main', fileEdits: [] })
  )).rejects.toBeInstanceOf(ProductSpecUnavailableError);
});
