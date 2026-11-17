import { vi, test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import JSZip from 'jszip';

const GENERATION_DELAY_MS = 40;

const { default: PlaygroundService } = await import('../../agents/playground/PlaygroundService.js');
const { Container } = await import('typedi');
const { setup, clear, teardown } = await import('../setup.js');
const { createUser, createLine, createProduct, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } = await import('../support/world.js');
const { runAs } = await import('../../linea/actingUser.js');

const playgroundService = Container.get(PlaygroundService);

async function unzipToMap(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const out = {};
  for (const [relPath, file] of Object.entries(zip.files)) {
    if (!file.dir) out[relPath] = await file.async('string');
  }
  return out;
}

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterEach(() => {
  vi.clearAllMocks();
});
afterAll(teardown);
afterAll(teardownFakeLinea);

test('generateBranchDownloadZip waits for LINEA to derive the product before merging it into the product output (no race)', async () => {
  const user = await createUser('playground-zip');
  const line = createLine({ user, name: 'PlaygroundZipLine' });
  const product = createProduct({ line, spec: { basicData: { name: 'TestProduct', version: '1.0.0' }, features: [] } });
  fakeLinea().git.getProject(product.repo.id).commit({ branch: 'main', actions: [{ action: 'create', path: 'product.txt', content: 'from-the-product' }], message: 'product code' });
  fakeLinea().state.derived = { 'marker.txt': 'generated-content' };
  fakeLinea().state.deriveDelayMs = GENERATION_DELAY_MS;

  const { buffer, productName } = await runAs(user._id, () => playgroundService.generateBranchDownloadZip({
    userId: String(user._id),
    productId: String(product._id),
    lineBranch: 'plan/xyz',
    featureSelection: [],
  }));

  expect(productName).toBe('TestProduct');

  const files = await unzipToMap(buffer);
  expect(files['marker.txt']).toBe('generated-content');
  expect(files['product.txt']).toBe('from-the-product');
  // it asked LINEA to derive from the line's branch
  const derive = fakeLinea().state.requests.find((r) => r.path.endsWith('/zip'));
  expect(derive.body.lineRef).toBe('plan/xyz');
});
