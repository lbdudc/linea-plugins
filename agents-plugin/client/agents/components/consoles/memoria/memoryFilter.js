
export function sortMemoriesByRecency(memories) {
  return [...(memories ?? [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function scorePercent(score) {
  return score == null ? null : Math.round(score * 100);
}
