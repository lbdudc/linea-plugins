import { Container } from 'typedi';
import { runToolLoop } from '../core/llm.js';
import { scanProducts, loadFeatureModel } from '../tools/splContext.js';
import AgentThreadRepository from '../models/AgentThreadRepository.js';

/**
 * Knowledge agent — conversational Q&A over one SPL, with persistent memory.
 *
 * Unlike the run-step agents, this is a multi-turn chat: each call loads the
 * thread history, runs Claude's tool loop over read-only deterministic getters,
 * and persists both sides so the conversation continues across requests.
 *
 * The tools are the deterministic core: Claude answers only from what they
 * return (product list/validity, the feature model), never from guesswork.
 */
const SYSTEM_PROMPT = `You are an assistant answering questions about a specific Software Product Line (SPL).
Use the provided tools to fetch facts before answering — never invent product or feature names; only use what the tools return.
Be concise and use markdown.`;

const TOOLS = [
  {
    name: 'list_products',
    description: 'List the products in this SPL with their feature selection and validity status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_feature_model',
    description: 'Return this SPL\'s feature model as text (UVL or XML).',
    input_schema: { type: 'object', properties: {} },
  },
];

export default class KnowledgeService {
  threadRepo = Container.get(AgentThreadRepository);

  #executeTool = async (name, _input, { lineId, userId }) => {
    if (name === 'list_products') {
      const scan = await scanProducts({ lineId, userId });
      return {
        summary: scan.summary,
        products: scan.verdicts.map((v) => ({
          name: v.name,
          version: v.version,
          status: v.status,
          features: v.features,
        })),
      };
    }
    if (name === 'get_feature_model') {
      const { modelStr, type } = await loadFeatureModel({ lineId, userId });
      return { type, model: modelStr };
    }
    return `Unknown tool: ${name}`;
  };

  ask = async ({ lineId, userId, threadId, content }) => {
    let thread = threadId ? await this.threadRepo.findThreadById(threadId) : null;
    if (!thread) {
      thread = await this.threadRepo.createThread({
        agentType: 'knowledge',
        scope: { lineId },
        userId,
        title: content.slice(0, 60),
      });
    }

    // Rebuild conversation memory from stored messages, then add the new question.
    const prior = await this.threadRepo.listMessages(thread._id);
    const history = prior.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
    history.push({ role: 'user', content });

    await this.threadRepo.addMessage({ threadId: thread._id, role: 'user', content });

    const { text } = await runToolLoop({
      system: SYSTEM_PROMPT,
      messages: history,
      tools: TOOLS,
      executeTool: (n, i) => this.#executeTool(n, i, { lineId, userId }),
    });

    await this.threadRepo.addMessage({ threadId: thread._id, role: 'assistant', content: text });
    await this.threadRepo.touchThread(thread._id);

    return { threadId: String(thread._id), reply: text };
  };

  listThreads = async ({ lineId, userId }) =>
    this.threadRepo.listThreads({ agentType: 'knowledge', lineId, userId });

  getMessages = async ({ threadId }) => this.threadRepo.listMessages(threadId);
}

Container.set(KnowledgeService, new KnowledgeService());
