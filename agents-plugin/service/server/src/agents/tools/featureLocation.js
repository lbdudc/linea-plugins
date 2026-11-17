import { validateFeatureSelection } from '../../linea/featureModel.js';

/**
 * Deterministic helpers for the Feature Location agent.
 * None of these functions make LLM or git host calls.
 */

/**
 * Try completeFeatureSelection and capture success vs error.
 * Returns { ok, selected, error? }
 */
export const tryCompleteFeatureSelection = (model, features) => {
  const { valid, completed, error } = validateFeatureSelection({ model, features });
  return valid
    ? { ok: true, selected: Array.isArray(completed) ? completed : [] }
    : { ok: false, selected: [], error };
};

/**
 * For each FM feature other than featureName, compute:
 *   coSelected      — products that select both featureName and F
 *   conditionalRate — P(F | featureName selected)
 *   baseRate        — P(F) across all valid products
 *
 * Returns array sorted by conditionalRate desc, limited to features that
 * co-appear with featureName in at least one product.
 */
export const computeCorrelations = (featureName, allFmFeatures, validVerdicts) => {
  const withFeature = validVerdicts.filter((v) => v.features.includes(featureName));
  if (validVerdicts.length === 0 || withFeature.length === 0) return [];

  return allFmFeatures
    .filter((f) => f !== featureName)
    .map((f) => {
      const coSelected = withFeature.filter((v) => v.features.includes(f)).length;
      const baseRate =
        validVerdicts.filter((v) => v.features.includes(f)).length / validVerdicts.length;
      const conditionalRate = coSelected / withFeature.length;
      return { feature: f, coSelected, conditionalRate, baseRate };
    })
    .filter((c) => c.coSelected > 0)
    .sort((a, b) => b.conditionalRate - a.conditionalRate);
};

/**
 * Insert a `/** @feature <featureName> *\/` JSDoc line above every definition of
 * `symbol` found in `source`. Handles the five JS definition patterns used by
 * extractDefinedFunctions. Idempotent: skips if the annotation already appears
 * on the line immediately above the definition.
 */
export const insertFeatureAnnotation = (source, symbol, featureName) => {
  const annotation = `/** @feature ${featureName} */`;
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Matches any of the five JS function definition forms that name `symbol`.
  const defRe = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*\\(` +
      `|(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:\\(|function)` +
      `|(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=\\s*async\\s` +
      `|${escaped}\\s*:\\s*(?:async\\s*)?function` +
      `|(?:async\\s+)?${escaped}\\s*\\([^)]*\\)\\s*\\{`
  );

  const lines = source.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    if (defRe.test(lines[i])) {
      const prevTrimmed = result.length > 0 ? result[result.length - 1].trim() : '';
      if (!prevTrimmed.includes(`@feature ${featureName}`)) {
        const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
        result.push(`${indent}${annotation}`);
      }
    }
    result.push(lines[i]);
  }

  return result.join('\n');
};
