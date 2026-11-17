
export function getFeatureSet(product) {
  const f = product?.spec?.features;
  if (Array.isArray(f)) return new Set(f);
  if (f && typeof f === 'object') return new Set(Object.keys(f).filter((k) => f[k]));
  const sel = product?.spec?.selection;
  if (Array.isArray(sel)) return new Set(sel);
  return new Set();
}

export function allFeatures(products) {
  const union = new Set();
  for (const p of products ?? []) {
    for (const f of getFeatureSet(p)) union.add(f);
  }
  return [...union].sort();
}

export function buildComparisonMatrix(products) {
  const lista = products ?? [];
  return allFeatures(lista).map((feature) => {
    const values = lista.map((p) => getFeatureSet(p).has(feature));
    return { feature, values, differsAcross: values.some((v) => v !== values[0]) };
  });
}

export function diffRows(matrix) {
  return matrix.filter((r) => r.differsAcross);
}

export function commonRows(matrix) {
  return matrix.filter((r) => !r.differsAcross && r.values[0]);
}
