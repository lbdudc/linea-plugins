import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { runAs } from '../../linea/actingUser.js';
import { ProductSpecUnavailableError } from '../../model/services/ProductSpecService.js';
import { validateProductFm } from '../../agents/sync/syncValidation.js';
import fmConstraintAdvisorAgentDefinition from '../../agents/definitions/fmConstraintAdvisorAgent.js';
import harvestAgentDefinition from '../../agents/definitions/harvestAgent.js';
import syncAgentDefinition from '../../agents/definitions/syncAgent.js';
import { FEATURE_MODEL_PATH } from '../../linea/featureModelFormat.js';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, createProduct, noFeatureSpec, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

test('fmConstraintAdvisorAgent open-mr: cutOnInfra aborts BEFORE opening the MR — no branch, no MR created', async () => {
  const user = await createUser('fmadvisor-cut');
  const line = createLine({ user, name: 'FmAdvisorCutLine' });
  createProduct({ line, spec: noFeatureSpec('FmAdvisorCutProduct') });

  const openMrStep = fmConstraintAdvisorAgentDefinition.steps.find((s) => s.name === 'open-mr');
  const ctx = {
    lineId: String(line._id),
    userId: user._id,
    getProposals: () => [{
      kind: 'fm_patch',
      decision: 'approved',
      target: { lineProjectId: line.repoId, lineId: String(line._id) },
      body: {
        constraints: [{ uvlText: 'A => B', pair: ['A', 'B'], rationale: 'test' }],
        markdown: 'x',
      },
    }],
  };

  const projectBefore = fakeLinea().git.getProject(line.repoId);
  const mrCountBefore = projectBefore.mergeRequests.size;
  const branchCountBefore = projectBefore.branches.size;

  fakeLinea().state.infra = true;
  await expect(runAs(user._id, () => openMrStep.run(ctx))).rejects.toBeInstanceOf(ProductSpecUnavailableError);

  const projectAfter = fakeLinea().git.getProject(line.repoId);
  expect(projectAfter.mergeRequests.size).toBe(mrCountBefore);
  expect(projectAfter.branches.size).toBe(branchCountBefore);
});

test('harvestAgent open-mr: cutOnInfra aborts BEFORE opening the MR — no branch, no MR created', async () => {
  const user = await createUser('harvest-cut');
  const line = createLine({ user, name: 'HarvestCutLine' });
  createProduct({ line, spec: noFeatureSpec('HarvestCutProduct') });

  const openMrStep = harvestAgentDefinition.steps.find((s) => s.name === 'open-mr');
  const ctx = {
    lineId: String(line._id),
    userId: user._id,
    getProposals: () => [{
      kind: 'fm_patch',
      decision: 'approved',
      target: { lineProjectId: line.repoId, modelPath: FEATURE_MODEL_PATH },
      body: {
        newModelUvl: 'namespace HarvestCutLine\nfeatures\n  Root\n',
        featureName: 'NewOptionalFeature',
        markdown: 'x',
        fileEdits: [],
      },
    }],
  };

  const projectBefore = fakeLinea().git.getProject(line.repoId);
  const mrCountBefore = projectBefore.mergeRequests.size;
  const branchCountBefore = projectBefore.branches.size;

  fakeLinea().state.infra = true;
  await expect(runAs(user._id, () => openMrStep.run(ctx))).rejects.toBeInstanceOf(ProductSpecUnavailableError);

  const projectAfter = fakeLinea().git.getProject(line.repoId);
  expect(projectAfter.mergeRequests.size).toBe(mrCountBefore);
  expect(projectAfter.branches.size).toBe(branchCountBefore);
});

test('validateProductFm: cutOnInfra:true throws ProductSpecUnavailableError on an infra read failure', async () => {
  const user = await createUser('validatefm-cut-true');
  const line = createLine({ user, name: 'ValidateFmCutTrueLine' });
  const product = createProduct({ line, spec: noFeatureSpec('ValidateFmCutTrueProduct') });

  fakeLinea().state.infra = true;
  await expect(
    runAs(user._id, () => validateProductFm({ productId: String(product._id), userId: user._id, cutOnInfra: true }))
  ).rejects.toBeInstanceOf(ProductSpecUnavailableError);
});

test('validateProductFm: cutOnInfra:false (default) falls back to Mongo instead of throwing on an infra read failure', async () => {
  const user = await createUser('validatefm-cut-false');
  const line = createLine({ user, name: 'ValidateFmCutFalseLine' });
  const product = createProduct({ line, spec: noFeatureSpec('ValidateFmCutFalseProduct') });

  fakeLinea().state.infra = true;
  const result = await runAs(user._id, () => validateProductFm({ productId: String(product._id), userId: user._id }));

  expect(result.violations).toEqual([]);
  expect(result.valid).toBe(true);
});

test('syncAgent apply-resolution: cutOnInfra aborts BEFORE committing the reconciled files', async () => {
  const user = await createUser('syncagent-cut');
  const line = createLine({ user, name: 'SyncAgentCutLine' });
  const product = createProduct({ line, spec: noFeatureSpec('SyncAgentCutProduct') });

  const applyResolutionStep = syncAgentDefinition.steps.find((s) => s.name === 'apply-resolution');
  const ctx = {
    lineId: String(line._id),
    productId: String(product._id),
    userId: user._id,
    getStepOutput: (name) => {
      if (name === 'diagnose') return { status: 'issue', key: 'conflicts_merge_request', stage: 'update', diagnosis: null };
      if (name === 'fetch-conflict-details') return { mr: null };
      return null;
    },
    getProposals: () => [{
      kind: 'merge_resolution',
      decision: 'approved',
      target: { projectId: product.repo.id, mrIid: 1, mrUrl: 'http://x', sourceBranch: 'bigbang' },
      body: { fileEdits: [{ path: 'src/platform/file.js', action: 'update', newContent: 'x' }], plan: {} },
    }],
  };

  const projectBefore = fakeLinea().git.getProject(product.repo.id);
  const bigbangHeadBefore = projectBefore.branches.get('bigbang');

  fakeLinea().state.infra = true;
  await expect(runAs(user._id, () => applyResolutionStep.run(ctx))).rejects.toBeInstanceOf(ProductSpecUnavailableError);

  const projectAfter = fakeLinea().git.getProject(product.repo.id);
  expect(projectAfter.branches.get('bigbang')).toBe(bigbangHeadBefore);
});
