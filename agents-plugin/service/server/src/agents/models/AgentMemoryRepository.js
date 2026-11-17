import { Container } from 'typedi';
import AgentMemory from './AgentMemory.js';
import { buildScopeQuery } from './scopeQuery.js';

export default class AgentMemoryRepository {
  async add({ scope, agentType, kind, content, sourceRunId, embedding, embeddingModel }) {
    return await new AgentMemory({
      scope,
      agentType,
      kind,
      content,
      sourceRunId,
      embedding,
      embeddingModel,
    }).save();
  }

  // productNullDefault: true — both callers (MemoryService.listForScope,
  // .searchRelevant's fallback) treat an absent productId as "line scope only",
  // same as deleteByScope below. Without it, an absent productId matched every
  // product on the line instead, so "line scope" listed/searched memories that
  // a same-scoped delete would never actually remove.
  async findByScope({ lineId, productId = null, agentType, limit = 50 }) {
    const query = buildScopeQuery({ lineId, productId, agentType, productNullDefault: true });
    return await AgentMemory.find(query).sort({ createdAt: -1 }).limit(limit);
  }

  // Filter for a run/candidate query. When an agentType is given, include the
  // agent's own memories AND human-authored `manual` notes (operator lessons are
  // meant for every agent). When omitted (UI recall preview), span all agents.
  #agentFilter(agentType) {
    return agentType ? { agentType: { $in: [agentType, 'manual'] } } : {};
  }

  // Load scoped memories for a scope, newest first. `readScope` controls which
  // scopes contribute (see AgentConfig.memoryRead):
  //   'product_line' → product + line memories (default)
  //   'product'      → product memories only (line is excluded when a productId
  //                    is present; on a line-level run it degrades to line)
  // `withEmbedding` pulls the (normally `select: false`) embedding vectors.
  async #findScoped({ lineId, productId, agentType, limit, withEmbedding = false, readScope = 'product_line' }) {
    const agentFilter = this.#agentFilter(agentType);
    const build = (scopeExtra) => {
      const q = AgentMemory.find({ 'scope.lineId': lineId, ...scopeExtra, ...agentFilter });
      if (withEmbedding) q.select('+embedding');
      return q.sort({ createdAt: -1 }).limit(limit);
    };
    const includeProduct = !!productId;
    // Line memories are included for 'product_line', or whenever there is no
    // product scope to read from (line-level run falls back to line memories).
    const includeLine = readScope === 'product_line' || !productId;
    const [lineMemories, productMemories] = await Promise.all([
      includeLine ? build({ 'scope.productId': null }) : Promise.resolve([]),
      includeProduct ? build({ 'scope.productId': productId }) : Promise.resolve([]),
    ]);
    const combined = [...productMemories, ...lineMemories];
    return combined.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  // Memories injected into a run.
  async findForRun({ lineId, productId, agentType, limit = 10, readScope = 'product_line' }) {
    return this.#findScoped({ lineId, productId, agentType, limit, readScope });
  }

  // Candidate pool for semantic retrieval, WITH embedding vectors. Cosine ranking
  // happens in Node (MemoryService).
  async findCandidates({ lineId, productId, agentType, limit = 300, readScope = 'product_line' }) {
    return this.#findScoped({ lineId, productId, agentType, limit, withEmbedding: true, readScope });
  }

  // Memories for a scope lacking an embedding vector — used by the backfill script.
  async findMissingEmbedding({ limit = 100 } = {}) {
    return await AgentMemory.find({ embedding: { $exists: false } }).limit(limit);
  }

  async setEmbedding(id, { embedding, embeddingModel }) {
    return await AgentMemory.findByIdAndUpdate(id, { embedding, embeddingModel }, { new: true });
  }

  async deleteById(id) {
    return await AgentMemory.findByIdAndDelete(id);
  }

  async deleteByScope({ lineId, productId = null }) {
    const query = buildScopeQuery({ lineId, productId, productNullDefault: true });
    return await AgentMemory.deleteMany(query);
  }
}

Container.set(AgentMemoryRepository, new AgentMemoryRepository());
