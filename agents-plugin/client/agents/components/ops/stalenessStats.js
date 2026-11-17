const DAY_MS = 86_400_000;

export function computeStalenessStats(products) {
  const lista = Array.isArray(products) ? products : [];
  const now = Date.now();
  let recent = 0, stale7 = 0, stale30 = 0, stale90 = 0, never = 0;
  for (const p of lista) {
    if (!p.lastSyncAt) {
      never += 1;
      continue;
    }
    const daysAgo = (now - new Date(p.lastSyncAt).getTime()) / DAY_MS;
    if (daysAgo < 7) recent += 1;
    else if (daysAgo < 30) stale7 += 1;
    else if (daysAgo < 90) stale30 += 1;
    else stale90 += 1;
  }
  return { recent, stale7, stale30, stale90, never };
}

export function computeStaleCount(products) {
  const { stale7, stale30, stale90, never } = computeStalenessStats(products);
  return stale7 + stale30 + stale90 + never;
}

export function sortProductsBySync(products) {
  const lista = Array.isArray(products) ? products : [];
  return [...lista].sort((a, b) => {
    if (!a.lastSyncAt && !b.lastSyncAt) return 0;
    if (!a.lastSyncAt) return -1;
    if (!b.lastSyncAt) return 1;
    return new Date(a.lastSyncAt) - new Date(b.lastSyncAt);
  });
}
