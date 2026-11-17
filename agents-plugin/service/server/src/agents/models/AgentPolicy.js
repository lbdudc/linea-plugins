import mongoose from 'mongoose';

/**
 * Per-product (or per-line default) autonomy configuration.
 *
 * - `productId` omitted  → the line-level default.
 * - `productId` present  → an override for that product.
 *
 * Resolution order at decision time: product policy → line default → built-in
 * defaults (see mergePolicy). The ApprovalGate applies the mode.
 *
 * Autonomy modes (new, replaces propose_and_wait | automatic):
 *   manual    — human at every gate (safest)
 *   semi      — auto only unambiguous reversible gates; human for ambiguous + irreversible (default)
 *   automatic — fully hands-off; LLM resolves ambiguous gates; auto-passes irreversible too
 *
 * Back-compat: stored docs may still carry the old values. LEGACY_MODE_MAP translates them on read.
 */

// Translate old two-state values to the new three-state model.
export const LEGACY_MODE_MAP = {
  propose_and_wait: 'manual',
  automatic: 'automatic',
};

export const normMode = (v) => LEGACY_MODE_MAP[v] ?? v ?? 'semi';

const agentPolicySchema = new mongoose.Schema(
  {
    scope: {
      lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line', required: true },
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    },
    // critical | normal — criticality seeds a 'manual' default for per-product mode
    // but is overridden by an explicit run-level autonomyMode stamp.
    criticality: { type: String, default: 'normal' },
    modes: {
      // manual | semi | automatic (also accepts legacy propose_and_wait | automatic)
      sync:      { type: String, default: 'semi' },
      harvest:   { type: String, default: 'semi' },
      evolution: { type: String, default: 'semi' },
      changeset: { type: String, default: 'semi' },
    },
  },
  { timestamps: true }
);

// One policy per scope (a missing productId counts as null → one line default).
agentPolicySchema.index({ 'scope.lineId': 1, 'scope.productId': 1 }, { unique: true });

export const POLICY_DEFAULTS = {
  criticality: 'normal',
  modes: { sync: 'semi', harvest: 'semi', evolution: 'semi', changeset: 'semi' },
};

/**
 * Pure resolution of the effective policy: product over line over defaults.
 * Normalises legacy mode strings to the new three-state vocabulary.
 * Exported separately so it can be unit-tested without a database.
 */
export const mergePolicy = (product, line) => {
  const pick = (key) => product?.[key] ?? line?.[key] ?? POLICY_DEFAULTS[key];
  const mode = (agent) =>
    normMode(product?.modes?.[agent] ?? line?.modes?.[agent] ?? POLICY_DEFAULTS.modes[agent]);
  return {
    criticality: pick('criticality'),
    modes: {
      sync:      mode('sync'),
      harvest:   mode('harvest'),
      evolution: mode('evolution'),
      changeset: mode('changeset'),
    },
  };
};

const AgentPolicy = mongoose.model('AgentPolicy', agentPolicySchema);

export default AgentPolicy;
