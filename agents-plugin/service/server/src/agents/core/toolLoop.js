import { runOneToolTurn } from './llm.js';
import { withTimeout } from './timeout.js';

/**
 * Durable multi-turn tool loop. The conversation, turn cursor and a UI-facing transcript
 * live on `stepDoc.loop` and are persisted through `checkpoint()` after every turn — so a
 * long investigation survives a restart (resumes from the saved convo, never re-issuing a
 * completed LLM turn) and each turn is timed independently. Tool execution errors are
 * captured as tool_result text by `runTurn` (matching the in-memory wrapper) rather than
 * failing the loop.
 *
 * Collaborators are injected so this is unit-testable without a database or the Anthropic
 * API: `checkpoint()` persists `stepDoc`, `emit()` streams it, `runTurn` performs one
 * model exchange (defaults to `runOneToolTurn`). Returns `{ text }` — the final answer, or
 * a limit notice when `maxTurns` is exhausted.
 */
export const runDurableToolLoop = async ({
  stepDoc,
  checkpoint,
  emit = () => {},
  turnTimeout = 0,
  runTurn = runOneToolTurn,
  system,
  messages,
  tools,
  executeTool,
  maxTurns = 8,
  maxTokens,
  memories,
  instructions,
}) => {
  // Seed on first entry; adopt the saved convo on resume.
  if (!stepDoc.loop) {
    stepDoc.loop = { convo: [...messages], turn: 0, turns: [] };
    await checkpoint();
  }

  while (stepDoc.loop.turn < maxTurns) {
    const i = stepDoc.loop.turn;
    const step = await withTimeout(
      runTurn({ system, convo: stepDoc.loop.convo, tools, executeTool, maxTokens, memories, instructions }),
      turnTimeout,
      `tool loop (turn ${i + 1})`
    );

    stepDoc.loop.convo.push(step.assistantBlock);

    if (step.done) {
      stepDoc.loop.turns.push({ index: i, toolCalls: [], text: step.text });
      stepDoc.loop.turn = i + 1;
      await checkpoint();
      emit();
      return { text: step.text };
    }

    stepDoc.loop.convo.push(step.toolResultsBlock);
    stepDoc.loop.turns.push({ index: i, toolCalls: step.toolCalls, text: '' });
    stepDoc.loop.turn = i + 1;
    await checkpoint();   // this turn's work survives a restart
    emit();               // stream the investigation to the timeline
  }

  return { text: 'I could not complete the request within the tool-call limit.' };
};
