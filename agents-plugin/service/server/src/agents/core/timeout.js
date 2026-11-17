/**
 * Race a promise against a timeout, rejecting with a labeled error if it wins.
 * `ms <= 0` (or falsy) means no timeout — the promise is returned as-is.
 *
 * Shared by AgentRunner (whole-step timeouts) and toolLoop (per-turn timeouts)
 * — previously two hand-kept copies of the same function.
 */
export const withTimeout = (promise, ms, label) => {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Step "${label}" timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
