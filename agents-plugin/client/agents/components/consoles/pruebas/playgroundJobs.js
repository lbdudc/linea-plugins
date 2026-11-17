
export function normalizeFeatures(spec) {
  if (!spec) return [];
  let f = spec.features;
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    f = Object.keys(f).filter((k) => f[k]);
  }
  return Array.isArray(f) ? f : (Array.isArray(spec?.selection) ? spec.selection : []);
}

export const IDLE_JOB = Object.freeze({ status: 'idle', jobId: null, log: [] });

export function jobFor(jobs, productId) {
  return jobs?.[productId] ?? IDLE_JOB;
}

export function findJobByJobId(jobs, jobId) {
  return Object.values(jobs ?? {}).find((j) => j.jobId === jobId) ?? null;
}

export function passedCount(jobs) {
  return Object.values(jobs ?? {}).filter((j) => j.status === 'passed').length;
}

export function failedCount(jobs) {
  return Object.values(jobs ?? {}).filter((j) => j.status === 'failed').length;
}

export function runningCount(jobs) {
  return Object.values(jobs ?? {}).filter((j) => j.status === 'running').length;
}
