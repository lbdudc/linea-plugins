/**
 * The catalog of available agents. Each definition is a declarative object:
 *
 *   {
 *     type:        'spl-health-snapshot',     // unique id
 *     title:       'SPL Health Snapshot',
 *     description: 'one line for the UI',
 *     scope:       'line' | 'product',         // what it needs to run
 *     steps: [
 *       { name, kind, run: async (ctx) => ({ output }) | ({ proposal }) },
 *       ...
 *     ],
 *   }
 *
 * A step's `run(ctx)` returns either `{ output }` (recorded, continue) or
 * `{ proposal }` (routed through the ApprovalGate — may pause the run). See
 * AgentRunner for the execution contract and the shape of `ctx`.
 */

const registry = new Map();

export const registerAgent = (definition) => {
  if (!definition?.type) throw new Error('Agent definition needs a `type`');
  registry.set(definition.type, definition);
};

export const getAgent = (type) => registry.get(type);

export const listAgents = () =>
  [...registry.values()].map(({ type, title, description, scope, steps }) => ({
    type,
    title,
    description,
    scope,
    steps: (steps ?? []).map((s) => ({ name: s.name, kind: s.kind })),
  }));
