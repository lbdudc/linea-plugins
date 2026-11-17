import { readFeatureModelUvl } from '../../linea/featureModelFormat.js';
import { Container } from 'typedi';
import LineService from '../../model/services/LineService.js';
import { lineAccess } from './git.js';
import { normalizeFeatureSelection, normalizeUvl, parseFeatureModel, validateFeatureSelection } from '../../linea/featureModel.js';
import { fmType } from '../../utils/fmType.js';
export { normalizeFeatureSelection };

/**
 * Read-only SPL context tools — the deterministic core agents read the world
 * through. Thin wrappers over the existing LineService that return plain,
 * serializable objects (safe to persist as step output and stream over the wire).
 *
 * The feature-shape and model-building logic mirrors AIService; the plan flags
 * extracting one shared helper (it lives here now and AIService can adopt it).
 */

const lineService = () => Container.get(LineService);

// In-process FM model cache — avoids redundant git host fetches within the same
// agent run (and across back-to-back runs for the same line).
const FM_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const fmCache = new Map(); // lineId → { value, expiresAt }

function getCachedFm(lineId) {
  const entry = fmCache.get(lineId);
  if (entry && Date.now() < entry.expiresAt) return entry.value;
  fmCache.delete(lineId);
  return null;
}

function setCachedFm(lineId, value) {
  fmCache.set(lineId, { value, expiresAt: Date.now() + FM_CACHE_TTL_MS });
}

export function invalidateFmCache(lineId) {
  if (lineId) fmCache.delete(lineId);
  else fmCache.clear();
}

/** The text of a feature model file, normalised: what to parse, and what to show or analyse as the model's source. */
export const featureModelText = (file) => {
  const raw =
    file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content;
  const type = fmType(file.featureModelType);
  // parseFeatureModel does not normalise: a model seeded with tabs and edited in
  // Monaco (spaces) parses in the FM editor (flamapy normalises) but would throw
  // "mismatched input ' ' expecting '<INDENT>'" here. Normalise UVL on read.
  return type === 'XML' ? raw : normalizeUvl({ uvl: raw });
};

export const buildFeatureModel = (file) => parseFeatureModel({ content: featureModelText(file), type: fmType(file.featureModelType) });

/**
 * Load the line's parsed feature model from a specific branch (no cache).
 * Used by the changeset plan step to read the proposed FM from a working branch.
 * Returns { model, modelStr, type }.
 */
export const loadFeatureModelFromBranch = async ({ lineId, userId, branch }) => {
  const { lineProjectId } = await lineAccess({ lineId, userId });
  const line = await lineService().findLineById({ id: lineId, userId });
  const type = 'UVL';
  const raw = await readFeatureModelUvl({ lineProjectId, lineId, userId, ref: branch });
  const content = normalizeUvl({ uvl: raw });
  const model = parseFeatureModel({ content, type });
  return { line, model, modelStr: content, type };
};

/**
 * Load the line's parsed feature model (plus its text form and type). Used by
 * agents that need the model object to validate proposed selections.
 */
export const loadFeatureModel = async ({ lineId, userId }) => {
  const cached = getCachedFm(lineId);
  if (cached) return cached;

  const line = await lineService().findLineById({ id: lineId, userId });
  const modelFile = await lineService().getFeatureModel({ id: lineId, userId });
  const model = buildFeatureModel(modelFile);
  const result = {
    line,
    model,
    // the model's source, not `model.toString()`: that is the parsed object's own text, not UVL, and the analysis parses UVL
    modelStr: featureModelText(modelFile),
    type: fmType(modelFile.featureModelType),
  };
  setCachedFm(lineId, result);
  return result;
};

/**
 * Validate every product in a line against the current feature model using the
 * same `completeFeatureSelection` that generation itself relies on — the source
 * of truth for "will this product generate".
 */
export const scanProducts = async ({ lineId, userId }) => {
  const { line, model: featureModel } = await loadFeatureModel({ lineId, userId });
  const products = await lineService().findProductsByLineId({ id: lineId, userId, specFromRepo: true });

  const verdicts = products.map((product) => {
    const features = normalizeFeatureSelection({ spec: product.spec });
    const { valid, error } = validateFeatureSelection({ model: featureModel, features });

    return {
      productId: String(product._id),
      name: product.spec?.basicData?.name ?? String(product._id),
      version: product.spec?.basicData?.version ?? '?',
      status: valid ? 'valid' : 'invalid',
      reason: valid ? null : error,
      features,
    };
  });

  const invalid = verdicts.filter((v) => v.status === 'invalid');

  return {
    line: { id: String(line._id), name: line.name },
    summary: {
      total: verdicts.length,
      valid: verdicts.length - invalid.length,
      invalid: invalid.length,
    },
    verdicts,
  };
};
