import Anthropic from '@anthropic-ai/sdk';
import {
  getAnthropicApiKey,
  getAnthropicModel,
  getAnthropicMaxTokens,
} from '../../model/connectors/properties.js';

/**
 * Shared LLM access for the agents — the same Anthropic config AIService uses.
 * The client is created lazily so this module can be imported (and unit-tested)
 * without an API key present.
 *
 * Three entry points: `complete` (single turn, often a forced tool used as structured
 * output), `runOneToolTurn` (one iteration of a tool-calling exchange — the durable
 * runner drives these and checkpoints between them), and `runToolLoop` (the in-memory
 * convenience wrapper around `runOneToolTurn`, used by the human-gated refine path
 * where mid-loop durability is not required).
 */
let client;

const getClient = () => {
  if (!client) {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      // Surface a clear, actionable error in the run timeline instead of the
      // SDK's cryptic "Could not resolve authentication method".
      throw new Error(
        'ANTHROPIC_API_KEY is not set in the server environment. ' +
          'Agent LLM steps (and AIService) require it. Ensure it is in the env file the ' +
          'server loads (server/.env — note server/.env.production does NOT contain it), ' +
          'then recreate the container so it is picked up: ' +
          '`docker compose up -d --force-recreate server`.'
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
};

const buildSystem = (system, memories, instructions) => {
  let sys = system ?? '';
  // Operator instructions are scope-level guidance set in the Customization tab.
  // They sit ahead of past-run memory so they read as standing policy, not history.
  if (instructions?.trim()) {
    sys += '\n\n---\n## Operator instructions for this line/product\n' + instructions.trim();
  }
  if (memories?.length) {
    sys +=
      '\n\n---\n## Memory from past runs (informational — learn from past decisions)\n' +
      memories.map((m) => `- ${m}`).join('\n');
  }
  return sys;
};

export const complete = async ({ system, messages, tools, maxTokens, memories, instructions } = {}) => {
  const sys = buildSystem(system, memories, instructions);
  const res = await getClient().messages.create({
    model: getAnthropicModel(),
    max_tokens: maxTokens ?? getAnthropicMaxTokens(),
    ...(sys ? { system: sys } : {}),
    ...(tools ? { tools } : {}),
    messages,
  });

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolUses = res.content.filter((b) => b.type === 'tool_use');

  return { text, toolUses, raw: res };
};

/**
 * One iteration of a tool-calling exchange against an existing conversation. Makes a
 * single model call; if Claude asks for tools, runs `executeTool` for each and returns
 * the assistant block plus the tool_result block to append (so the caller can persist
 * them between turns). When Claude stops calling tools, returns `done: true` with the
 * final text. `executeTool(name, input)` returns a string or JSON-able value.
 *
 * The caller owns the convo array and the turn loop — this keeps one place that talks to
 * the API, shared by the durable runner (`ctx.runToolLoop`) and the in-memory wrapper.
 */
export const runOneToolTurn = async ({ system, convo, tools, executeTool, maxTokens, memories, instructions } = {}) => {
  const sys = buildSystem(system, memories, instructions);
  const res = await getClient().messages.create({
    model: getAnthropicModel(),
    max_tokens: maxTokens ?? getAnthropicMaxTokens(),
    ...(sys ? { system: sys } : {}),
    ...(tools ? { tools } : {}),
    messages: convo,
  });

  const assistantBlock = { role: 'assistant', content: res.content };
  const toolUses = res.content.filter((b) => b.type === 'tool_use');

  if (toolUses.length === 0) {
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { done: true, text, assistantBlock, toolUses: [], toolResults: [], raw: res };
  }

  const toolCalls = [];
  const results = [];
  for (const tu of toolUses) {
    let content;
    let status = 'done';
    const startedAt = Date.now();
    try {
      const out = await executeTool(tu.name, tu.input ?? {});
      content = typeof out === 'string' ? out : JSON.stringify(out);
    } catch (err) {
      content = `Error: ${err?.message ?? String(err)}`;
      status = 'failed';
    }
    toolCalls.push({ name: tu.name, input: tu.input ?? {}, status, durationMs: Date.now() - startedAt });
    results.push({ type: 'tool_result', tool_use_id: tu.id, content });
  }

  return {
    done: false,
    text: '',
    assistantBlock,
    toolUses,
    toolResultsBlock: { role: 'user', content: results },
    toolCalls,
    raw: res,
  };
};

/**
 * Multi-turn tool-calling loop held entirely in memory: repeatedly calls
 * `runOneToolTurn` until Claude produces a final text answer (or the turn limit is hit).
 * Used by the human-gated refine path; for in-run agent steps prefer the durable
 * `ctx.runToolLoop` which checkpoints between turns.
 */
export const runToolLoop = async ({ system, messages, tools, executeTool, maxTurns = 6, maxTokens, memories, instructions } = {}) => {
  const convo = [...messages];

  for (let turn = 0; turn < maxTurns; turn++) {
    const step = await runOneToolTurn({ system, convo, tools, executeTool, maxTokens, memories, instructions });
    convo.push(step.assistantBlock);
    if (step.done) return { text: step.text, messages: convo };
    convo.push(step.toolResultsBlock);
  }

  return { text: 'I could not complete the request within the tool-call limit.', messages: convo };
};
