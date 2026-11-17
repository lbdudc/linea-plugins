/**
 * The one place agents imports `@lbdudc/linea-core` (src/test/linea/coreBoundary.test.js keeps it so).
 *
 * Agents works on feature models as UVL and on products as `{ spec, features }`, and asks linea-core to parse, normalise and check
 * them. linea-core is published on its own and its feature-model API has been changing (the metamodel refactor removed the functions
 * below, and agents is pinned to the release that still has them: see package.json). When agents moves to a newer linea-core, this
 * file is where each of these gets rewritten on the new API; nothing else in agents has to know.
 */
export {
  assertFeatureSelection,
  computeMandatoryFeatures,
  deriveProduct,
  extractArchive,
  extractFeatureNames,
  normalizeFeatureSelection,
  normalizeProductSpec,
  normalizeUvl,
  parseFeatureModel,
  validateFeatureSelection,
  validateModelAgainstSelections,
} from '@lbdudc/linea-core';
