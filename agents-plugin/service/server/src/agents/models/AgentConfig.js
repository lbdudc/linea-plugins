import mongoose from 'mongoose';

/**
 * Per-agent customization for a scope (line default or product override).
 *
 * - `productId` omitted  → the line-level default for this agent type.
 * - `productId` present  → an override for that product.
 *
 * One row configures one agent type within one scope. Resolution at run time is
 * product over line over built-in defaults (see mergeConfig) — the same
 * precedence as AgentPolicy. Agent *definitions* stay code-based; this document
 * only toggles/tunes them: whether the agent is attached, extra operator
 * instructions injected into its LLM steps, preset default inputs, and which
 * automatic triggers may launch it.
 */
const agentConfigSchema = new mongoose.Schema(
  {
    scope: {
      lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line', required: true },
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    },
    agentType: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    instructions: { type: String, default: '' },
    // RAG read scope — which memories this agent recalls into its prompt:
    //   'product_line' → product + line memories (default; the SPL-aware agent)
    //   'product'      → only this product's memories (isolated)
    //   'none'         → no recall at all (stateless reads)
    // For a line-level run (no productId), 'product' degrades to line memories,
    // since there is no product scope to read from.
    memoryRead: {
      type: String,
      enum: ['none', 'product', 'product_line'],
      default: 'product_line',
    },
    // RAG write mode — whether/where this agent records new memories:
    //   'run'     → record at the run's own scope (default; current behaviour)
    //   'product' → force product scope (skipped on line-level runs)
    //   'line'    → force line scope
    //   'auto'    → let the LLM decide whether the outcome is worth remembering
    //   'off'     → never record
    memoryWrite: {
      type: String,
      enum: ['off', 'auto', 'run', 'product', 'line'],
      default: 'run',
    },
    // Preset launch inputs (featureName, mode, …) — merged under user-supplied input.
    defaultInput: { type: mongoose.Schema.Types.Mixed, default: {} },
    triggers: {
      webhook: { type: Boolean, default: true },
      schedule: { type: String, default: null }, // cron string, or null for none
    },
  },
  { timestamps: true }
);

// One config per (scope, agentType). A missing productId counts as null → the
// line default for that agent type.
agentConfigSchema.index(
  { 'scope.lineId': 1, 'scope.productId': 1, agentType: 1 },
  { unique: true }
);

export const CONFIG_DEFAULTS = {
  enabled: true,
  instructions: '',
  defaultInput: {},
  memoryRead: 'product_line',
  memoryWrite: 'run',
  triggers: { webhook: true, schedule: null },
};

/**
 * Pure resolution of the effective config: product over line over defaults.
 * Exported separately so it can be unit-tested without a database.
 */
export const mergeConfig = (product, line) => {
  const pick = (key) => product?.[key] ?? line?.[key] ?? CONFIG_DEFAULTS[key];
  return {
    enabled: product?.enabled ?? line?.enabled ?? CONFIG_DEFAULTS.enabled,
    instructions: pick('instructions'),
    defaultInput: { ...(line?.defaultInput ?? {}), ...(product?.defaultInput ?? {}) },
    memoryRead: pick('memoryRead'),
    memoryWrite: pick('memoryWrite'),
    triggers: {
      webhook: product?.triggers?.webhook ?? line?.triggers?.webhook ?? CONFIG_DEFAULTS.triggers.webhook,
      schedule: product?.triggers?.schedule ?? line?.triggers?.schedule ?? CONFIG_DEFAULTS.triggers.schedule,
    },
  };
};

const AgentConfig = mongoose.model('AgentConfig', agentConfigSchema);

export default AgentConfig;
