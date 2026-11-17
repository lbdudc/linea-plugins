import { describe, it, expect, vi } from 'vitest';
import { runDurableToolLoop } from '../../agents/core/toolLoop.js';

/**
 * Durable tool-loop checkpointing, resume and per-turn timeout — exercised against the
 * injectable helper with a plain stepDoc and a scripted `runTurn`, so no database or
 * Anthropic API is required. These are the reliability guarantees Workstream A adds:
 * turn-by-turn persistence, resume from the saved conversation without re-issuing a
 * completed turn, and an independent per-turn timeout.
 */

// A scripted turn runner: each call returns the next entry. tool_use turns carry a
// toolResultsBlock; the final turn is `done` with text.
const scriptedRunTurn = (script) => {
  let i = 0;
  return vi.fn(async () => script[Math.min(i++, script.length - 1)]);
};

const toolUseTurn = (name) => ({
  done: false,
  assistantBlock: { role: 'assistant', content: [{ type: 'tool_use', id: `tu_${name}`, name, input: {} }] },
  toolResultsBlock: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu_${name}`, content: 'ok' }] },
  toolCalls: [{ name, input: {}, status: 'done', durationMs: 1 }],
});

const finalTurn = (text) => ({ done: true, text, assistantBlock: { role: 'assistant', content: [{ type: 'text', text }] } });

describe('runDurableToolLoop', () => {
  it('checkpoints the conversation and transcript after every turn', async () => {
    const stepDoc = { name: 'investigate' };
    const checkpoint = vi.fn(async () => {});
    const emit = vi.fn();
    const runTurn = scriptedRunTurn([toolUseTurn('read_file'), finalTurn('all done')]);

    const out = await runDurableToolLoop({
      stepDoc,
      checkpoint,
      emit,
      runTurn,
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      executeTool: async () => 'ok',
      maxTurns: 8,
    });

    expect(out.text).toBe('all done');
    // seed + 2 turns = 3 checkpoints; convo holds the seed + both assistant blocks + the tool_result
    expect(checkpoint).toHaveBeenCalledTimes(3);
    expect(stepDoc.loop.turn).toBe(2);
    expect(stepDoc.loop.turns).toHaveLength(2);
    expect(stepDoc.loop.turns[0].toolCalls[0].name).toBe('read_file');
    expect(stepDoc.loop.turns[1].text).toBe('all done');
    // convo: seed(1) + assistant tool_use(1) + tool_result(1) + assistant final(1) = 4
    expect(stepDoc.loop.convo).toHaveLength(4);
  });

  it('resumes from the saved convo without re-issuing a completed turn', async () => {
    // A stepDoc that already completed turn 0 (one tool_use exchange) before a "restart".
    const stepDoc = {
      name: 'investigate',
      loop: {
        convo: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'read_file', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_x', content: 'ok' }] },
        ],
        turn: 1,
        turns: [{ index: 0, toolCalls: [{ name: 'read_file', input: {}, status: 'done', durationMs: 1 }], text: '' }],
      },
    };
    const checkpoint = vi.fn(async () => {});
    const runTurn = scriptedRunTurn([finalTurn('resumed and finished')]);

    const out = await runDurableToolLoop({
      stepDoc,
      checkpoint,
      runTurn,
      messages: [{ role: 'user', content: 'go' }], // ignored on resume
      maxTurns: 8,
    });

    expect(out.text).toBe('resumed and finished');
    // Only the final turn runs — the completed turn 0 is NOT replayed.
    expect(runTurn).toHaveBeenCalledTimes(1);
    // The loop continued from the saved convo (it began this run already 3 messages deep),
    // not from the seed, and advanced past the pre-existing turn.
    expect(stepDoc.loop.turn).toBe(2);
    expect(stepDoc.loop.turns).toHaveLength(2);
  });

  it('enforces a per-turn timeout independent of any whole-step budget', async () => {
    const stepDoc = { name: 'slow' };
    const runTurn = vi.fn(() => new Promise(() => {})); // never resolves

    await expect(
      runDurableToolLoop({
        stepDoc,
        checkpoint: async () => {},
        runTurn,
        turnTimeout: 20,
        messages: [{ role: 'user', content: 'go' }],
        maxTurns: 8,
      })
    ).rejects.toThrow(/timed out/);
  });

  it('returns a limit notice when maxTurns is exhausted', async () => {
    const stepDoc = { name: 'loopy' };
    const runTurn = scriptedRunTurn([toolUseTurn('read_file')]); // always asks for a tool

    const out = await runDurableToolLoop({
      stepDoc,
      checkpoint: async () => {},
      runTurn,
      messages: [{ role: 'user', content: 'go' }],
      maxTurns: 3,
    });

    expect(out.text).toMatch(/could not complete/i);
    expect(stepDoc.loop.turn).toBe(3);
  });
});
