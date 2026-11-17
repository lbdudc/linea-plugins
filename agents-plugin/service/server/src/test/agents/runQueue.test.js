import { describe, it, expect, vi } from 'vitest';
import { createRunQueue } from '../../agents/core/runQueue.js';

/**
 * Bounded-concurrency run queue — the guarantees Workstream 1C adds to the runner:
 * at most N advances in flight, the same run never advanced twice concurrently, parent
 * wakes never lost, and a crashing run never stalls the pool. Exercised against the
 * injectable helper with a scripted `advance`, so no DB or runner is required.
 */

// A deferred promise so a test can hold an advance "in flight" and release it on cue.
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createRunQueue', () => {
  it('never exceeds the concurrency ceiling and runs every enqueued id once', async () => {
    let active = 0;
    let peak = 0;
    const counts = new Map();
    const advance = vi.fn(async (id) => {
      active += 1; peak = Math.max(peak, active);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      await flush();
      active -= 1;
    });

    const q = createRunQueue({ advance, maxConcurrency: () => 2 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) q.enqueue(id);

    // Drain.
    for (let i = 0; i < 20 && (q.waiting || q.active); i++) await flush();

    expect(peak).toBeLessThanOrEqual(2);
    expect([...counts.values()]).toEqual([1, 1, 1, 1, 1]); // each id advanced exactly once
    expect(advance).toHaveBeenCalledTimes(5);
  });

  it('maxConcurrency of 1 is strictly serial', async () => {
    let active = 0;
    let peak = 0;
    const advance = async () => { active += 1; peak = Math.max(peak, active); await flush(); active -= 1; };
    const q = createRunQueue({ advance, maxConcurrency: () => 1 });
    ['a', 'b', 'c'].forEach((id) => q.enqueue(id));
    for (let i = 0; i < 12 && (q.waiting || q.active); i++) await flush();
    expect(peak).toBe(1);
  });

  it('does not advance the same run twice concurrently; a wake mid-advance re-runs it after', async () => {
    const gate = deferred();
    const calls = [];
    let first = true;
    const advance = vi.fn(async (id) => {
      calls.push(id);
      if (id === 'x' && first) { first = false; await gate.promise; } // hold the first 'x' in flight
    });

    const q = createRunQueue({ advance, maxConcurrency: () => 4 });
    q.enqueue('x');              // starts advancing 'x' (now in flight, awaiting gate)
    await flush();
    q.enqueue('x');              // wake while in flight → must NOT start a second concurrent advance
    await flush();
    expect(calls.filter((c) => c === 'x')).toHaveLength(1); // still only one in flight

    gate.resolve();             // release the first advance
    for (let i = 0; i < 10 && q.active; i++) await flush();
    // The pending wake re-ran 'x' exactly once more, after the first finished.
    expect(calls.filter((c) => c === 'x')).toHaveLength(2);
  });

  it('a wake for an already-queued (not yet running) id is de-duplicated', async () => {
    const gate = deferred();
    const advance = vi.fn(async (id) => { if (id === 'a') await gate.promise; });
    const q = createRunQueue({ advance, maxConcurrency: () => 1 });

    q.enqueue('a');     // starts running (held on the gate)
    await flush();
    q.enqueue('b');     // queued behind 'a'
    q.enqueue('b');     // duplicate while still only queued → ignored
    gate.resolve();
    for (let i = 0; i < 10 && (q.waiting || q.active); i++) await flush();

    expect(advance.mock.calls.filter((c) => c[0] === 'b')).toHaveLength(1);
  });

  it('a crashing advance does not stall the pool', async () => {
    const seen = [];
    const advance = vi.fn(async (id) => {
      seen.push(id);
      if (id === 'boom') throw new Error('kaboom');
    });
    const q = createRunQueue({ advance, maxConcurrency: () => 1 });
    ['boom', 'next'].forEach((id) => q.enqueue(id));
    for (let i = 0; i < 10 && (q.waiting || q.active); i++) await flush();
    expect(seen).toEqual(['boom', 'next']); // 'next' still processed after the crash
  });
});
