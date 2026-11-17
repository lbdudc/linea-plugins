import { Container } from 'typedi';
import { registerAgent } from '../core/AgentRegistry.js';
import ProductService from '../../model/services/ProductService.js';

/**
 * Per-product regeneration. Wraps the existing `ProductService.generateProduct`
 * pipeline so a single product re-sync becomes a first-class, tracked agent run —
 * the unit the line-sync orchestrator fans out (one regen child per product).
 *
 * Conflict handling needs no code here: a conflicting generation emits the
 * `PRODUCT_GENERATED` domain event, which the agents' domainSubscriber turns into
 * an auto-enqueued `sync` resolver run for that product. So the regen run simply
 * records the outcome (clean / conflict / failed); the resolver shows up
 * separately on the Sync Console, correlated by line + product.
 */
const definition = {
  type: 'regen',
  title: 'Regenerate Product',
  description:
    "Regenerates a single product against the latest line platform. On a merge conflict the sync resolver is auto-spawned to propose a resolution.",
  scope: 'product',

  steps: [
    {
      name: 'regenerate',
      // Custom budget (STEP_TIMEOUTS.regen): the generate pipeline downloads the
      // line + product, runs the engine and opens/merges merge requests — minutes.
      kind: 'regen',
      run: async (ctx) => {
        if (!ctx.productId) throw new Error('regen agent requires scope.productId');
        if (!ctx.userId) throw new Error('regen agent requires a creating user (for git access)');

        // LINEA generates the product, logs the generation and tells the person's open pages; it answers when it is done.
        const result = await Container.get(ProductService).generateProduct({ id: ctx.productId, userId: ctx.userId });

        const conflicts = Boolean(result?.conflicts);
        const stage = result?.stage ?? null;
        const version = result?.version ?? result?.spec?.basicData?.version ?? null;

        return {
          output: { conflicts, stage, version },
          result: { conflicts, stage, version },
        };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
