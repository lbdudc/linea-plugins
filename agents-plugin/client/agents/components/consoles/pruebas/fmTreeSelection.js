export function toDisplayNode(node) {
  if (!node || node.hidden) return null;
  const children = (node.children ?? []).map(toDisplayNode).filter(Boolean);
  return {
    id: node.name,
    label: node.name,
    fmType: node.type ?? 'AND',
    mandatory: Boolean(node.mandatory),
    children,
  };
}

export function toDisplayTree(tree) {
  if (!tree) return [];
  const root = toDisplayNode(tree);
  return root ? [root] : [];
}

export function collectMandatory(node) {
  if (!node || node.hidden) return [];
  const result = node.mandatory ? [node.name] : [];
  for (const child of node.children ?? []) {
    result.push(...collectMandatory(child));
  }
  return result;
}

export function withMandatory(selection, mandatoryNames) {
  return [...new Set([...(mandatoryNames ?? []), ...(selection ?? [])])];
}

export function sameSelection(a, b) {
  const sa = [...(a ?? [])].sort();
  const sb = [...(b ?? [])].sort();
  return JSON.stringify(sa) === JSON.stringify(sb);
}

export function collectFeatureNames(node) {
  const set = new Set();
  const queue = [node];
  while (queue.length) {
    const n = queue.shift();
    if (!n) continue;
    set.add(n.name);
    for (const c of n.children ?? []) queue.push(c);
  }
  return set;
}

export function autoAdjustForProposedFm(selection, currentFm, proposedFm) {
  if (!proposedFm || !currentFm) return [...(selection ?? [])];
  const cur = collectFeatureNames(currentFm);
  const prop = collectFeatureNames(proposedFm);
  const added = [...prop].filter((f) => !cur.has(f));
  let next = added.length ? [...new Set([...(selection ?? []), ...added])] : [...(selection ?? [])];
  next = next.filter((f) => prop.has(f));
  return next;
}
