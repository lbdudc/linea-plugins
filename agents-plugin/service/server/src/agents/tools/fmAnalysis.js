/**
 * Shared deterministic helpers for FM-level analysis.
 * Used by coverage-analysis and fm-health agents.
 *
 * None of these functions make LLM or git host calls — they are pure utilities
 * over the FeatureModel object and the product verdicts returned by scanProducts.
 */
import {
  extractFeatureNames,
  computeMandatoryFeatures as coreComputeMandatoryFeatures,
} from '../../linea/featureModel.js';
import { fmType } from '../../utils/fmType.js';

const UVL_KEYWORDS = new Set([
  'features', 'constraints', 'mandatory', 'optional', 'alternative', 'or', 'and',
  'as', 'type', 'String', 'Integer', 'Real', 'Boolean', 'include', 'namespace',
  'cardinality', 'abstract', 'true', 'false', 'null',
]);

function parseUvlFeatureNames(uvl) {
  const names = new Set();
  for (const line of uvl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    // Namespace declarations are not feature lines
    if (trimmed.startsWith('namespace')) continue;
    for (const m of trimmed.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      if (!UVL_KEYWORDS.has(m[1])) names.add(m[1]);
    }
  }
  return [...names];
}

function parseXmlFeatureNames(xml) {
  const names = new Set();
  for (const m of xml.matchAll(/\bname="([^"]+)"/g)) names.add(m[1]);
  return [...names];
}

/**
 * Extract feature names from a model string (UVL or XML).
 * Conservative parser — prefers false positives over false negatives.
 * A few extra identifiers (e.g. type names) are harmless; they appear as
 * stranded features in the portfolio analysis (selected by no product) and
 * the LLM interprets them correctly.
 */
export const extractFeaturesFromModel = ({ modelStr, type }) =>
  extractFeatureNames({ content: modelStr, type: fmType(type) });

/**
 * Probe the model with an empty selection to detect:
 *   - void model (no valid configuration exists at all)
 *   - mandatory features (always present even without being explicitly requested)
 *
 * If completeFeatureSelection does not return an array (return value unused in
 * most callers), mandatory stays [] — zombie/stranded analysis degrades gracefully.
 */
export const computeMandatoryFeatures = ({ model }) => coreComputeMandatoryFeatures({ model });

/**
 * Aggregate stranded, zombie-optional, coupling-smell, and selected-feature computation
 * in one pass. Callers pass the already-computed `mandatory` array so this stays pure.
 */
export const computePortfolioAnomalies = ({ allFmFeatures, validVerdicts, mandatory }) => {
  const mandatorySet = new Set(mandatory);
  const selectedFeatures = new Set(validVerdicts.flatMap((v) => v.features));
  const stranded = allFmFeatures.filter((f) => !selectedFeatures.has(f) && !mandatorySet.has(f));
  const zombieOptionals = validVerdicts.length
    ? allFmFeatures.filter(
        (f) => !mandatorySet.has(f) && validVerdicts.every((v) => v.features.includes(f))
      )
    : [];
  const couplingSmells = findCouplingSmells(allFmFeatures, validVerdicts);
  return { stranded, zombieOptionals, couplingSmells, selectedFeatures };
};

/**
 * Compute the set of covered 2-wise feature pairs across a product portfolio.
 * Returns { coveredPairs: Set<string>, totalPairs: number }.
 * Pair keys are sort-joined with null byte: "A\x00B".
 */
export const computePairCoverage = (fmFeatures, productFeatureSets) => {
  const covered = new Set();
  for (const featureSet of productFeatureSets) {
    const arr = [...featureSet];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        covered.add([arr[i], arr[j]].sort().join('\x00'));
      }
    }
  }
  const n = fmFeatures.length;
  return { coveredPairs: covered, totalPairs: (n * (n - 1)) / 2 };
};

/**
 * Given a list of feature names and an array of product verdicts (from scanProducts),
 * compute coupling smells: pairs that are always co-selected whenever either is selected.
 * Only considers features actually used by at least one product.
 */
export const findCouplingSmells = (fmFeatures, validVerdicts) => {
  const result = [];
  const used = fmFeatures.filter((f) =>
    validVerdicts.some((v) => v.features.includes(f))
  );
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const a = used[i];
      const b = used[j];
      const withA = validVerdicts.filter((v) => v.features.includes(a));
      const withB = validVerdicts.filter((v) => v.features.includes(b));
      if (
        withA.length > 0 &&
        withB.length > 0 &&
        withA.every((v) => v.features.includes(b)) &&
        withB.every((v) => v.features.includes(a))
      ) {
        result.push([a, b]);
      }
    }
  }
  return result;
};
