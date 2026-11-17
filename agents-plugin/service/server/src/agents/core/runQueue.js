/**
 * A bounded-concurrency, de-duplicated run queue.
 *
 * Distinct runs advance in parallel up to `maxConcurrency()`; the guarantees it
 * protects are that (a) the SAME run is never advanced by two workers at once
 * (`inFlight`), (b) a wake arriving for a run while it is mid-advance is not lost —
 * it is re-processed once the in-flight advance finishes (`pendingWake`, e.g. a batch
 * parent woken by a second child while still handling the first), and (c) a run is
 * never queued twice (`queued`).
 *
 * Extracted from AgentRunner so these concurrency guarantees can be unit-tested
 * without a database or the Anthropic API — mirroring the durable tool-loop extraction.
 *
 * @param {(runId: string) => Promise<void>} advance  Advance one run to its next
 *   pause/terminal state. Rejections are caught and logged (one crashing run must not
 *   stall the pool).
 * @param {() => number} maxConcurrency  The current ceiling, read live so a config
 *   change applies to the next scheduling decision. Coerced to an integer ≥ 1.
 */
export const createRunQueue = ({ advance, maxConcurrency }) => {
  const queue = [];
  const queued = new Set();
  const inFlight = new Set();
  const pendingWake = new Set();
  let workers = 0;

  const limit = () => Math.max(1, Math.floor(Number(maxConcurrency()) || 1));

  const schedule = () => {
    while (workers < limit() && queue.length) {
      workers += 1;
      void runWorker();
    }
  };

  const runWorker = async () => {
    try {
      while (queue.length) {
        const id = queue.shift();
        if (id === undefined) break;
        queued.delete(id);
        inFlight.add(id);
        try {
          await advance(id);
        } catch (err) {
          console.error(`[agents] run ${id} crashed:`, err);
        } finally {
          inFlight.delete(id);
          // A wake arrived while this run was advancing → re-process its new state.
          if (pendingWake.delete(id)) enqueue(id);
        }
      }
    } finally {
      workers -= 1;
    }
  };

  const enqueue = (runId) => {
    const id = String(runId);
    // Already advancing → don't double-advance the same doc; record the wake so the
    // run is re-processed once its current advance finishes.
    if (inFlight.has(id)) { pendingWake.add(id); return; }
    if (queued.has(id)) return; // already waiting its turn
    queue.push(id);
    queued.add(id);
    schedule();
  };

  return {
    enqueue,
    // Introspection for tests / diagnostics.
    get waiting() { return queue.length; },
    get active() { return inFlight.size; },
  };
};
