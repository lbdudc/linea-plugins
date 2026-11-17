import { FEATURE_MODEL_PATH, readFeatureModelUvl, toLineaFeatureModel } from '../../linea/featureModelFormat.js';
import { Container } from 'typedi';
import { normalizeUvl, parseFeatureModel, validateModelAgainstSelections } from '../../linea/featureModel.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';
import { normalizeFeatureSelection } from './splContext.js';
import { fmType } from '../../utils/fmType.js';
import { branches } from './git.js';
import * as repo from '../../linea/repo.js';
import { classifyFiles } from './sync.js';

/**
 * Tools for the Harvest agent (lift code UP: product → SPL).
 *
 * Deterministic safety core: `validateModelAgainstProducts` — any proposed
 * feature-model change must still admit EVERY existing product's spec, so adding
 * a feature never breaks a sibling product. The agent proposes; this decides.
 */

/**
 * The direct, un-harvested changes in a product: commits/diffs that `main` has
 * beyond a baseline ref (default: `bigbang`, the generated baseline). A clean
 * product has none. Pass `fromRef` to scope the comparison to a specific commit.
 */
export const detectProductChanges = async ({ userId, projectId, fromRef }) => {
  const cmp = await repo.compareBranches({
    userId,
    id: projectId,
    from: fromRef ?? branches.base,
    to: branches.default,
  });

  const files = (cmp?.files ?? [])
    // `.linea/**` es metadato nuestro, no cambio del producto (ADR-033)
    .filter((d) => !d.newPath?.startsWith('.linea/'))
    .map((d) => ({
      path: d.newPath,
      added: d.status === 'added',
      deleted: d.status === 'deleted',
      renamed: d.status === 'renamed',
      diff: d.patch,
    }));

  const commits = files.length === 0
    ? []
    : (cmp?.commits ?? []).map((c) => ({
      id: c.shortId,
      message: c.title,
      author: c.authorName,
      date: c.createdAt,
    }));

  return { files, commits };
};

/**
 * The harvest change taxonomy. Each detected divergence is classified into one of
 * these; the type drives the proposal shape, the markdown, and how the Variant
 * Divergence Miner aggregates across products.
 *   new-optional-feature    — a new capability → new optional feature + gated edits
 *   extend-existing-feature — belongs to a feature already in the FM → edit its impl
 *   bugfix-to-generated     — a fix to generator-owned code every product should get
 *   product-local           — a customization point / one-off → do NOT harvest
 *   ambiguous               — could not be classified confidently → ask a human
 */
export const HARVEST_CHANGE_TYPES = [
  'new-optional-feature',
  'extend-existing-feature',
  'bugfix-to-generated',
  'product-local',
  'ambiguous',
];

const FIX_RE = /\b(fix|fixes|fixed|bug|bugfix|hotfix|patch|regression)\b/i;

/**
 * Deterministic classification signals over a product's detected changes. These
 * ground the LLM's final change-type decision (which may override them) and let
 * the Variant Divergence Miner cluster product divergences without any LLM call.
 *
 * Reuses the Sync agent's file-ownership classifier (`classifyFiles`): a
 * "customization point" (README/.env/compose/CI) is product-local; a
 * generator-owned file is a candidate for harvesting up into the platform.
 */
export const classifyChangeSignals = ({ files = [], commits = [] }) => {
  const ownership = classifyFiles(files);
  const customizationPaths = ownership.files
    .filter((f) => f.resolution === 'ours')
    .map((f) => f.path);
  const generatorOwnedPaths = ownership.files
    .filter((f) => f.resolution === 'theirs')
    .map((f) => f.path);
  const allCustomization = files.length > 0 && generatorOwnedPaths.length === 0;
  const fixHint = (commits ?? []).some((c) => FIX_RE.test(c.message ?? ''));

  let suggestedType = 'ambiguous';
  if (allCustomization) suggestedType = 'product-local';
  else if (fixHint && generatorOwnedPaths.length) suggestedType = 'bugfix-to-generated';

  return { customizationPaths, generatorOwnedPaths, allCustomization, fixHint, suggestedType };
};

/** Read the line's feature model from its repository, as UVL (see linea/featureModelFormat.js). */
export const readLineModel = async ({ lineProjectId, lineId, userId }) => ({
  type: 'UVL',
  path: FEATURE_MODEL_PATH,
  content: await readFeatureModelUvl({ lineProjectId, lineId, userId }),
});

/**
 * Deterministic core: does the proposed model still admit every product's spec?
 * Returns { valid, broken: [{ name, reason }] }.
 */
export const validateModelAgainstProducts = ({ modelContent, type, products }) => {
  const model = parseFeatureModel({ content: modelContent, type: fmType(type) });
  const selections = products.map((product) => ({
    name: product.spec?.basicData?.name ?? String(product._id),
    features: normalizeFeatureSelection({ spec: product.spec }),
  }));
  return validateModelAgainstSelections({ model, selections });
};

export const findProductByRepoId = async (projectId, { userId, host } = {}) =>
  Container.get(ProductRepository).findByRepoId(projectId, { userId, host });

// What LINEA keeps in a line's repository for itself: the manifest, the lockfile, the models, the index of products, the generator's metadata.
const LINEA_FILES = [/^spl\.json$/, /^linea\.lock\.json$/, /^products\.json$/, /^models\//, /^\.linea\//, /^\.git/, /^README(\.md)?$/i];

/** Whether a path of a line's repository is platform (what products are derived from), not something LINEA keeps for itself. */
export const isPlatformFile = (file) => Boolean(file) && !file.startsWith('/') && !file.split('/').includes('..') && !LINEA_FILES.some((re) => re.test(file));

/** The files of the line's repository that are the platform, on `ref` (default branch by default). */
export const listPlatformFiles = async ({ userId, lineProjectId, ref = branches.default }) =>
  ((files) => (files.some((f) => f.startsWith('src/')) ? files.filter((f) => f.startsWith('src/')) : files))(
    (await repo.listFiles({ id: lineProjectId, userId, ref })).filter(isPlatformFile));

/** Read any file from the line repo (used so the model can edit real platform files). */
export const readRepoFile = async ({ userId, lineProjectId, path }) => {
  const text = await repo.readFile({ id: lineProjectId, userId, path, ref: branches.default });
  if (text === null) throw new Error(`No such file in the line repository: ${path}`);
  return text;
};

/**
 * Open the harvest MR on the line repo: branch off main, commit the updated
 * feature model, open the MR, and post the platform plan as a comment.
 *
 * Hardened:
 *   - dryRun: skip git writes; return the would-be payload for inspection.
 *   - Branch creation tolerates "already exists" (409/422) so resume after a
 *     partial step doesn't create a duplicate branch.
 */
export const openLineHarvestMr = async ({
  lineProjectId,
  lineId,
  userId,
  modelPath,
  newModelContent,
  featureName,
  planMarkdown,
  fileEdits = [],
  title: titleOverride,
  dryRun = false,
}) => {
  const safeName = (featureName ?? 'change').replace(/[^a-zA-Z0-9_-]/g, '-');
  // Use plan/ prefix so the harvest branch is directly reusable as a changeset
  // working branch — the auto-triggered ChangeSet merges it into main.
  const branch = `plan/${safeName}-${Date.now()}`;
  const title = titleOverride ?? `Harvest: add optional feature ${featureName ?? '(change)'}`;

  // Commit the feature-model change and every proposed platform file edit together.
  const actions = [];
  if (newModelContent && modelPath) {
    // Normalise UVL indentation (tabs/CRLF from Monaco) before it lands in the
    // repo, so the changeset agent that later reads this branch parses the same
    // thing the FM editor validated. linea-core's parseFeatureModel does not
    // normalise on its own.
    // The line keeps its feature model as a model of its feature metamodel, not as UVL: LINEA converts it.
    const content = modelPath === FEATURE_MODEL_PATH
      ? await toLineaFeatureModel({ lineId, userId, uvl: normalizeUvl({ uvl: newModelContent }) })
      : newModelContent;
    actions.push({ action: 'update', path: modelPath, content });
  }
  for (const edit of fileEdits) {
    if (!edit?.path || edit.newContent == null) continue;
    actions.push({
      action: edit.action === 'create' ? 'create' : 'update',
      path: edit.path,
      content: edit.newContent,
    });
  }
  if (actions.length === 0) throw new Error('Harvest MR has no file changes to commit.');

  if (dryRun) {
    return { dryRun: true, branch, title, filesCommitted: actions.length, actions };
  }

  // createBranch is idempotent: an already-exists error means the branch is
  // there (e.g. the runner resumed after a partial execution). We continue; the
  // commit below will simply add onto the existing branch.
  try {
    await repo.createBranch({ id: lineProjectId, userId, branch, ref: branches.default });
  } catch (err) {
    if (!repo.isBranchAlreadyExistsError(err)) throw err;
    // Branch already exists — safe to continue
  }

  try {
    await repo.commit({ id: lineProjectId, userId, branch, message: title, actions });
  } catch (err) {
    throw new Error(`Harvest: failed to commit ${actions.length} file(s) to branch "${branch}": ${err?.message ?? err}`);
  }

  let mr;
  try {
    mr = await repo.createMergeRequest({ id: lineProjectId, userId, title, sourceBranch: branch, targetBranch: branches.default });
  } catch (err) {
    throw new Error(`Harvest: failed to open MR from "${branch}" → main: ${err?.message ?? err}`);
  }

  if (planMarkdown) {
    try {
      await repo.postMergeRequestComment({ id: lineProjectId, userId, number: mr.number, body: planMarkdown });
    } catch {
      // Non-fatal: MR is open, comment failed
    }
  }

  return { mrUrl: mr.webUrl, mrIid: mr.number, branch, filesCommitted: actions.length };
};
