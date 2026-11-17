export function overrideOf(overrides, productId) {
  return overrides?.[productId] ?? 'include';
}

export function deriveMatrixRows({ cascade, childRunsById, overrides, mode }) {
  return (cascade ?? []).map((entry) => {
    const child = childRunsById?.[entry.productId] ?? null;
    const override = overrideOf(overrides, entry.productId);

    let outcomeKind = null;
    if (mode !== 'planning') {
      if (override === 'defer') outcomeKind = 'deferred';
      else if (override === 'skip' || entry.action === 'skip') outcomeKind = 'skipped';
      else if (child) outcomeKind = 'child';
    }

    return { ...entry, child, override, outcomeKind };
  });
}
