import mongoose from 'mongoose';
import { vi, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, createProduct, noFeatureSpec, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';
import AgentRunner from '../../agents/core/AgentRunner.js';
import { handlePush } from '../../agents/triggers/pushSubscriber.js';
import WebhookDelivery from '../../agents/models/WebhookDelivery.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

let enqueue;
beforeEach(() => {
  delete process.env.BOT_USER;
  enqueue = vi.spyOn(Container.get(AgentRunner), 'enqueueNew').mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
});
afterEach(() => vi.restoreAllMocks());

// a product of a line, whose repository has the generated baseline (`bigbang`) and `main`
const world = async ({ username = 'someone' } = {}) => {
  const user = await createUser('pusher', { username });
  const line = createLine({ user, name: 'PushLine' });
  const product = createProduct({ line, spec: noFeatureSpec('PushProduct') });
  const project = fakeLinea().git.getProject(product.repo.id);
  project.createBranch('bigbang', 'main');
  return { user, line, product, project };
};
const change = (project, path, content = 'x') =>
  project.commit({ branch: 'main', actions: [{ action: 'create', path, content }], message: `change ${path}` });

test('a push to a branch that is not main is ignored', async () => {
  const { product } = await world();
  const outcome = await handlePush({ repositoryId: product.repo.id, branch: 'feature/x', username: 'someone' });
  expect(outcome.status).toBe('ignored');
  expect(enqueue).not.toHaveBeenCalled();
});

test('a push by somebody who has not signed in to agents, with no BOT_USER, enqueues nothing and never looks the product up', async () => {
  const { product } = await world();
  const requestsBefore = fakeLinea().state.requests.length;
  const outcome = await handlePush({ repositoryId: product.repo.id, branch: 'main', username: 'stranger' });
  expect(outcome.status).toBe('no_user');
  expect(fakeLinea().state.requests.length).toBe(requestsBefore);
  expect(enqueue).not.toHaveBeenCalled();
});

test('a push to a repository that is not a tracked product is ignored', async () => {
  await world();
  const outcome = await handlePush({ repositoryId: 424242, branch: 'main', username: 'someone' });
  expect(outcome.status).toBe('ignored');
  expect(enqueue).not.toHaveBeenCalled();
});

test('a push whose only change beyond the baseline is under .linea/ is discarded (no Harvest enqueued)', async () => {
  const { product, project } = await world();
  change(project, '.linea/spec.json');
  const outcome = await handlePush({ repositoryId: product.repo.id, branch: 'main', username: 'someone' });
  expect(outcome.status).toBe('ignored');
  expect(enqueue).not.toHaveBeenCalled();
});

test('a push that brings a real change to main enqueues a Harvest run for that product, as the person who pushed', async () => {
  const { user, line, product, project } = await world();
  change(project, '.linea/spec.json');
  change(project, 'src/custom.js', 'console.log(1)');
  const outcome = await handlePush({ repositoryId: product.repo.id, branch: 'main', username: 'someone' });
  expect(outcome.status).toBe('harvest_enqueued');
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
    agentType: 'harvest',
    scope: { productId: String(product._id), lineId: String(line._id) },
    userId: String(user._id),
    trigger: expect.objectContaining({ kind: 'git_push' }),
  }));
  expect(await WebhookDelivery.countDocuments({ status: 'enqueued', username: 'someone' })).toBe(1);
});

test('a push that does not say which branch is judged by what main has beyond the baseline', async () => {
  const { product, project } = await world();
  change(project, 'src/custom.js');
  const outcome = await handlePush({ repositoryId: product.repo.id, username: 'someone' });
  expect(outcome.status).toBe('harvest_enqueued');
});

test('the BOT_USER takes it when the person who pushed is not known to agents', async () => {
  const { product, project } = await world({ username: 'agents-bot' });
  process.env.BOT_USER = 'agents-bot';
  change(project, 'src/custom.js');
  const outcome = await handlePush({ repositoryId: product.repo.id, branch: 'main', username: 'stranger' });
  expect(outcome.status).toBe('harvest_enqueued');
});

test('sync: fetchConflict and recheckMergeability ask each MR in full, because a host list does not always say conflicts', async () => {
  const { user, product, project } = await world();
  const userId = String(user._id);
  const { fetchConflict, recheckMergeability } = await import('../../agents/tools/sync.js');
  project.createBranch('feature', 'main');
  project.commit({ branch: 'feature', actions: [{ action: 'create', path: 'f.txt', content: 'f' }], message: 'f' });
  const mr = { number: project.nextMr++, state: 'opened', title: 'conflicting', sourceBranch: 'feature', targetBranch: 'main', hasConflicts: true };
  project.mergeRequests.set(mr.number, mr);
  const found = await fetchConflict({ userId, projectId: product.repo.id, stage: 'update' });
  expect(found.mr).toMatchObject({ iid: mr.number, hasConflicts: true });
  const again = await recheckMergeability({ userId, projectId: product.repo.id, mrIid: mr.number, maxRetries: 0 });
  expect(again).toMatchObject({ found: true, hasConflicts: true });
  mr.hasConflicts = false;
  expect(await recheckMergeability({ userId, projectId: product.repo.id, mrIid: mr.number, maxRetries: 0 })).toMatchObject({ found: true, hasConflicts: false });
});
