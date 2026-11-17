import { Container } from 'typedi';
import AgentThread from './AgentThread.js';
import AgentMessage from './AgentMessage.js';
import { buildScopeQuery } from './scopeQuery.js';

/**
 * Persistence for conversational agents (Knowledge). Keeps threads and their
 * messages — the memory that lets a chat continue across requests/sessions.
 */
export default class AgentThreadRepository {
  async createThread({ agentType, scope, userId, title }) {
    return await new AgentThread({ agentType, scope, userId, title }).save();
  }

  async findThreadById(id) {
    return await AgentThread.findById(id);
  }

  async listThreads({ agentType, lineId, userId }) {
    const query = buildScopeQuery({ lineId, agentType });
    if (userId) query.userId = userId;
    return await AgentThread.find(query).sort({ updatedAt: 'desc' });
  }

  async touchThread(id) {
    return await AgentThread.findByIdAndUpdate(id, { updatedAt: new Date() });
  }

  async addMessage({ threadId, role, content }) {
    return await new AgentMessage({ threadId, role, content }).save();
  }

  async listMessages(threadId) {
    return await AgentMessage.find({ threadId }).sort({ createdAt: 'asc' });
  }
}

Container.set(AgentThreadRepository, new AgentThreadRepository());
