import { classifyImpact } from './evolution.js';

/**
 * Classify a feature-model edit per Thüm's taxonomy (ICSE 2009):
 *   refactoring    — the edit leaves the valid configuration set unchanged for
 *                    the existing portfolio (no product breaks, no product fixes).
 *   generalization — the edit only opens new valid configurations; no existing
 *                    product's selection becomes invalid.
 *   specialization — the edit only closes configurations; some existing products
 *                    will have selections that are no longer valid.
 *   arbitrary      — the edit both opens and closes configurations (some break,
 *                    some are fixed).
 *
 * Deterministic: uses `completeFeatureSelection` on both models across the full
 * live product portfolio. The portfolio sample approximates the full config-set
 * comparison (exact config-set equality would require a SAT solver); for the
 * purposes of the family impact plan, the portfolio-sample approximation is
 * sufficient — it identifies breaking/fixing/unaffected exactly with respect to
 * products that exist.
 *
 * @param {object} opts
 * @param {FeatureModel} opts.currentModel  - current (committed) FM
 * @param {FeatureModel} opts.proposedModel - proposed (to-be-committed) FM
 * @param {Array}        opts.products      - array of Product Mongoose docs
 * @returns {{
 *   editClass: 'refactoring'|'generalization'|'specialization'|'arbitrary',
 *   breaking:  Array,   // products valid on current, invalid on proposed
 *   fixing:    Array,   // products invalid on current, valid on proposed
 *   unaffected: Array,  // products valid on both (unchanged valid)
 *   invalidOnBoth: Array // products invalid on both (pre-existing problem)
 * }}
 */
export const classifyFmEdit = ({ currentModel, proposedModel, products }) => {
  const verdicts = classifyImpact({ currentModel, proposedModel, products });

  const breaking     = verdicts.filter((v) => v.impact === 'breaking');
  const fixing       = verdicts.filter((v) => v.impact === 'fixing');
  const unaffected   = verdicts.filter((v) => v.impact === 'unaffected_valid');
  const invalidOnBoth = verdicts.filter((v) => v.impact === 'unaffected_invalid');

  let editClass;
  if (breaking.length === 0 && fixing.length === 0) editClass = 'refactoring';
  else if (breaking.length === 0)                    editClass = 'generalization';
  else if (fixing.length === 0)                      editClass = 'specialization';
  else                                               editClass = 'arbitrary';

  return { editClass, breaking, fixing, unaffected, invalidOnBoth };
};
