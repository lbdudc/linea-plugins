/**
 * Shared helpers for building Mongo queries against the `scope` sub-document
 * ({ lineId, productId }) used by agent runs, memories and threads — and for
 * extracting string scope ids off a loaded run.
 */

/**
 * Build a scope filter. Only truthy fields are included, except when
 * `productNullDefault` is set, where an absent productId pins `scope.productId`
 * to null (line-level only).
 */
export function buildScopeQuery({ lineId, productId, agentType, productNullDefault = false } = {}) {
  const query = {};
  if (lineId) query['scope.lineId'] = lineId;
  if (productId) query['scope.productId'] = productId;
  else if (productNullDefault) query['scope.productId'] = null;
  if (agentType) query.agentType = agentType;
  return query;
}

/** Stringify a run's scope ids (or null when absent). */
export function extractScopeIds(run) {
  return {
    lineId: run?.scope?.lineId ? String(run.scope.lineId) : null,
    productId: run?.scope?.productId ? String(run.scope.productId) : null,
  };
}
