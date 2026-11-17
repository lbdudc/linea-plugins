import { Container } from 'typedi';
import MongooseRepository from '../../model/repositories/MongooseRepository.js';
import AgentConfig, { mergeConfig } from './AgentConfig.js';

export default class AgentConfigRepository extends MongooseRepository {
  constructor() {
    super(AgentConfig);
  }

  // All stored config rows for a scope (one per configured agent type).
  async findByScope({ lineId, productId = null }) {
    return await this.model.find({
      'scope.lineId': lineId,
      'scope.productId': productId ?? null,
    });
  }

  // productId null/undefined → the line-level default document.
  async findOneByScope({ lineId, productId = null, agentType }) {
    return await this.model.findOne({
      'scope.lineId': lineId,
      'scope.productId': productId ?? null,
      agentType,
    });
  }

  async upsertByScope({ lineId, productId = null, agentType }, data) {
    return await this.model.findOneAndUpdate(
      { 'scope.lineId': lineId, 'scope.productId': productId ?? null, agentType },
      { $set: { ...data, scope: { lineId, productId: productId ?? null }, agentType } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  // Effective config for one agent in a scope: product over line over defaults.
  async resolveEffective({ lineId, productId = null, agentType }) {
    const [product, line] = await Promise.all([
      productId ? this.findOneByScope({ lineId, productId, agentType }) : null,
      lineId ? this.findOneByScope({ lineId, productId: null, agentType }) : null,
    ]);
    return mergeConfig(product, line);
  }

  // Like resolveEffective, but also returns the raw line- and product-scope rows so
  // the UI can show which fields are inherited vs explicitly overridden.
  async resolveEffectiveWithSource({ lineId, productId = null, agentType }) {
    const [product, line] = await Promise.all([
      productId ? this.findOneByScope({ lineId, productId, agentType }) : null,
      lineId ? this.findOneByScope({ lineId, productId: null, agentType }) : null,
    ]);
    return {
      config: mergeConfig(product, line),
      lineConfig: line,
      productConfig: product,
    };
  }

  // Remove a single agent's row for a scope. At product scope this drops the
  // override so the agent falls back to the line default ("reset to line default").
  async deleteByScope({ lineId, productId = null, agentType }) {
    return await this.model.deleteOne({
      'scope.lineId': lineId,
      'scope.productId': productId ?? null,
      agentType,
    });
  }
}

Container.set(AgentConfigRepository, new AgentConfigRepository());
