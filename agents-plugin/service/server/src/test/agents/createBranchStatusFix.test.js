import { test, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { createBranch, isBranchAlreadyExistsError } from '../../linea/repo.js';
import { openLineHarvestMr } from '../../agents/tools/harvest.js';
import { FEATURE_MODEL_PATH } from '../../linea/featureModelFormat.js';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, fakeLinea, setupFakeLinea, resetFakeLinea, teardownFakeLinea } from '../support/world.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

test('a branch that is already there is an error LINEA says so about (400)', async () => {
  const user = await createUser('createbranch-status');
  const line = createLine({ user, name: 'CreateBranchStatusLine' });
  const userId = String(user._id);

  await createBranch({ userId, id: line.repoId, branch: 'plan/dup', ref: 'main' });

  let caught = null;
  try {
    await createBranch({ userId, id: line.repoId, branch: 'plan/dup', ref: 'main' });
  } catch (err) {
    caught = err;
  }
  expect(caught).not.toBeNull();
  expect(caught.status).toBe(400);
  expect(caught.message).toMatch(/already exists/i);
  expect(isBranchAlreadyExistsError(caught)).toBe(true);
});

test('isBranchAlreadyExistsError recognises what LINEA answers (400) and the other statuses a host has used (409/422), all needing a matching message', () => {
  expect(isBranchAlreadyExistsError({ status: 400, message: 'Branch already exists' })).toBe(true);
  // LINEA gives what the host said in `detail`
  expect(isBranchAlreadyExistsError({ status: 400, message: 'LINEA POST /x → 400', body: { error: 'error_messages.repository_refused', detail: 'The branch plan/dup already exists' } })).toBe(true);
  expect(isBranchAlreadyExistsError({ status: 409, message: 'Branch already exists' })).toBe(true);
  expect(isBranchAlreadyExistsError({ status: 422, message: 'Branch already exists' })).toBe(true);
});

test('isBranchAlreadyExistsError does NOT swallow a genuine 400 validation error (e.g. an invalid reference name)', () => {
  expect(isBranchAlreadyExistsError({ status: 400, message: 'Invalid reference name' })).toBe(false);
  expect(isBranchAlreadyExistsError({ status: 400, message: 'Bad Request' })).toBe(false);
  expect(isBranchAlreadyExistsError({ status: 403, message: 'Branch already exists' })).toBe(false);
  expect(isBranchAlreadyExistsError({ status: 500, message: 'Internal Server Error' })).toBe(false);
  expect(isBranchAlreadyExistsError(null)).toBe(false);
});

test('openLineHarvestMr resumes cleanly when its branch was already created by a prior (partial) attempt', async () => {
  const user = await createUser('harvestmr-resume');
  const line = createLine({ user, name: 'HarvestMrResumeLine' });
  const fixedNow = 1_700_000_000_000;
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
  try {
    const expectedBranch = `plan/ResumeFeature-${fixedNow}`;
    await createBranch({ userId: String(user._id), id: line.repoId, branch: expectedBranch, ref: 'main' });

    const result = await openLineHarvestMr({
      lineProjectId: line.repoId, lineId: line._id, userId: String(user._id),
      modelPath: FEATURE_MODEL_PATH,
      newModelContent: 'namespace X\nfeatures\n  Root\n',
      featureName: 'ResumeFeature',
      planMarkdown: 'x',
      fileEdits: [],
    });

    expect(result.branch).toBe(expectedBranch);
    expect(result.mrUrl).toBeTruthy();

    const project = fakeLinea().git.getProject(line.repoId);
    const branchHead = project.branches.get(expectedBranch);
    expect(project.commits.get(branchHead).tree.has(FEATURE_MODEL_PATH)).toBe(true);
    // what was committed is the text LINEA made of the UVL, not the UVL
    expect(project.commits.get(branchHead).tree.get(FEATURE_MODEL_PATH).toString('utf8')).toMatch(/^featuremodel from-uvl/);
  } finally {
    nowSpy.mockRestore();
  }
});
