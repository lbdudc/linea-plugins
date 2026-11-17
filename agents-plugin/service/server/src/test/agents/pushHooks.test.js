import { test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, createProduct, noFeatureSpec, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';
import { ensureProductPushHooks } from '../../agents/triggers/pushHooks.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

beforeEach(() => {
  delete process.env.BOT_USER;
});

const world = async () => {
  const bot = await createUser('bot', { username: 'agents-bot' });
  process.env.BOT_USER = 'agents-bot';
  const line = createLine({ user: bot, name: 'HookLine' });
  const product = createProduct({ line, spec: noFeatureSpec('HookProduct') });
  return { bot, line, product, project: fakeLinea().git.getProject(product.repo.id) };
};

test('asks LINEA for the push hook of each product of the bot (LINEA knows the host and how)', async () => {
  const { project } = await world();

  const result = await ensureProductPushHooks();

  expect(result).toMatchObject({ created: 1, failed: 0 });
  expect(project.hooks).toBe(1);
  expect(fakeLinea().git.state.calls.some((c) => c.method === 'POST' && c.path === '/push-hook')).toBe(true);
});

test('is idempotent: a product that has the hook is left alone', async () => {
  const { project } = await world();

  await ensureProductPushHooks();
  const second = await ensureProductPushHooks();

  expect(second.created).toBe(0);
  expect(project.hooks).toBe(2); // (asked twice; the fake counts the asks and says "already_exists" the second time)
});

test('says so, and stops, when LINEA has no public address or secret to give the host', async () => {
  const { project } = await world();
  fakeLinea().git.state.hooksUnavailable = true;

  const result = await ensureProductPushHooks();

  expect(result).toMatchObject({ created: 0, unavailable: true });
  expect(project.hooks).toBe(0);
});

test('does nothing when the bot has not signed in to agents (there is nobody to act as)', async () => {
  const { project } = await world();
  process.env.BOT_USER = 'someone-else';

  const result = await ensureProductPushHooks();

  expect(result.skipped).toBe(true);
  expect(project.hooks).toBe(0);
});

test('a product whose hook cannot be asked for is counted as failed and does not stop the rest', async () => {
  const { line, project } = await world();
  const other = createProduct({ line, spec: noFeatureSpec('OtherHookProduct') });
  fakeLinea().git.state.repos.delete(project.id);

  const result = await ensureProductPushHooks();

  expect(result).toMatchObject({ created: 1, failed: 1 });
  expect(fakeLinea().git.getProject(other.repo.id).hooks).toBe(1);
});
