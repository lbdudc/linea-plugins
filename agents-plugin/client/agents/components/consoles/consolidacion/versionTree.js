export const ROW_HEIGHT = 44;
export const INDENT_STEP = 18;
export const BULLET_X = 22;

export function hasChildrenOf(versions, versionId) {
  const key = String(versionId);
  return (versions ?? []).some((v) => String(v.parentVersionId ?? '') === key);
}

export function lockedVersionIds(versions) {
  const locked = new Set();
  const byEpoch = new Map();
  for (const v of versions ?? []) {
    if (!byEpoch.has(v.epoch)) byEpoch.set(v.epoch, []);
    byEpoch.get(v.epoch).push(v);
  }
  for (const versionsInEpoch of byEpoch.values()) {
    const mergedOne = versionsInEpoch.find((v) => v.status === 'merged');
    if (!mergedOne) continue;
    for (const v of versionsInEpoch) {
      if (String(v._id) === String(mergedOne._id)) continue;
      if (v.status === 'archived') continue;
      locked.add(String(v._id));
    }
  }
  return locked;
}

export function isVersionLocked(versions, version) {
  if (!version) return false;
  if (version.status === 'merged' || version.status === 'archived') return false;
  return lockedVersionIds(versions).has(String(version._id));
}

export function buildRows(versions, collapsedIds) {
  const collapsed = collapsedIds ?? new Set();
  const byEpoch = new Map();
  for (const v of versions ?? []) {
    if (!byEpoch.has(v.epoch)) byEpoch.set(v.epoch, []);
    byEpoch.get(v.epoch).push(v);
  }
  const epochs = [...byEpoch.entries()].sort(([a], [b]) => b - a);

  const flat = [];
  for (const [epoch, list] of epochs) {
    flat.push({ kind: 'header', epoch });

    const childrenByParent = new Map();
    const rootsOfEpoch = [];
    for (const v of list) {
      const parentId = v.parentVersionId ? String(v.parentVersionId) : null;
      const parentInThisEpoch = parentId && list.some((x) => String(x._id) === parentId);
      if (!parentInThisEpoch) {
        rootsOfEpoch.push(v);
        continue;
      }
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(v);
    }
    rootsOfEpoch.sort((a, b) => a.minor - b.minor);
    for (const arr of childrenByParent.values()) arr.sort((a, b) => a.minor - b.minor);

    const walk = (node, depth) => {
      const kids = childrenByParent.get(String(node._id)) ?? [];
      const hasKids = kids.length > 0;
      const isCollapsed = hasKids && collapsed.has(String(node._id));
      flat.push({
        kind: 'node',
        version: node,
        depth,
        hasChildren: hasKids,
        collapsed: isCollapsed,
      });
      if (isCollapsed) return;
      for (const child of kids) walk(child, depth + 1);
    };
    for (const root of rootsOfEpoch) walk(root, 0);
  }
  return flat;
}

export function buildPositions(rows, { rowHeight = ROW_HEIGHT, indentStep = INDENT_STEP, bulletX = BULLET_X } = {}) {
  const pos = new Map();
  rows.forEach((r, i) => {
    if (r.kind === 'node') {
      pos.set(String(r.version._id), {
        x: bulletX + r.depth * indentStep,
        y: i * rowHeight + rowHeight / 2,
      });
    }
  });
  return pos;
}

export function buildConnectors(rows, positions) {
  const lines = [];
  for (const r of rows) {
    if (r.kind !== 'node') continue;
    const parentId = r.version.parentVersionId;
    if (!parentId) continue;
    const p = positions.get(String(parentId));
    const c = positions.get(String(r.version._id));
    if (!p || !c) continue;
    const midY = (p.y + c.y) / 2;
    lines.push({
      d: `M ${p.x} ${p.y} C ${p.x} ${midY}, ${c.x} ${midY}, ${c.x} ${c.y}`,
      key: `${parentId}->${r.version._id}`,
    });
  }
  return lines;
}
