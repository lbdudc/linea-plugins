import { test, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import ChangesetVersionService from '../../agents/changeset/ChangesetVersionService.js';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, fakeLinea, setupFakeLinea, resetFakeLinea, teardownFakeLinea } from '../support/world.js';

let failRefName = null;
let mainAttempted = false;

vi.mock('../../linea/repo.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createBranch: async (args) => {
      if (args.ref === 'main') mainAttempted = true;
      if (failRefName !== null && args.ref === failRefName) {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      }
      return actual.createBranch(args);
    },
  };
});

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(() => { failRefName = null; mainAttempted = false; });
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

test('createForkFrom falls back to main when the parent branch genuinely no longer exists (404)', async () => {
  const versionService = ChangesetVersionService.get();

  const user = await createUser('fork-badref');
  const line = createLine({ user, name: 'ForkBadRefLine' });

  const root = await versionService.createRootVersion({ lineId: String(line._id), userId: user._id, intent: 'root' });

  const project = fakeLinea().git.getProject(line.repoId);
  project.branches.delete(root.branch);

  const fork = await versionService.createForkFrom({
    lineId: String(line._id), userId: user._id, parentVersionId: String(root._id), intent: 'fork',
  });

  expect(project.branches.has(fork.branch)).toBe(true);
});

test('createForkFrom does NOT fall back to main on a 403 — it rethrows instead of silently forking off the wrong ref', async () => {
  const versionService = ChangesetVersionService.get();

  const user = await createUser('fork-forbidden');
  const line = createLine({ user, name: 'ForkForbiddenLine' });

  const root = await versionService.createRootVersion({ lineId: String(line._id), userId: user._id, intent: 'root' });
  mainAttempted = false;

  failRefName = root.branch;
  await expect(
    versionService.createForkFrom({ lineId: String(line._id), userId: user._id, parentVersionId: String(root._id), intent: 'fork' })
  ).rejects.toMatchObject({ status: 403 });
  expect(mainAttempted).toBe(false);
});
