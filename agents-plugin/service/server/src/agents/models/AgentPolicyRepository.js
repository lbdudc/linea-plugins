import { Container } from 'typedi';
import MongooseRepository from '../../model/repositories/MongooseRepository.js';
import AgentPolicy, { mergePolicy } from './AgentPolicy.js';

export default class AgentPolicyRepository extends MongooseRepository {
  constructor() {
    super(AgentPolicy);
  }

  // productId null/undefined → the line-level default document.
  async findOneByScope({ lineId, productId = null }) {
    return await this.model.findOne({
      'scope.lineId': lineId,
      'scope.productId': productId ?? null,
    });
  }

  async upsertByScope({ lineId, productId = null }, data) {
    return await this.model.findOneAndUpdate(
      { 'scope.lineId': lineId, 'scope.productId': productId ?? null },
      { $set: { ...data, scope: { lineId, productId: productId ?? null } } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  // Effective policy for a product: product over line over built-in defaults.
  async resolveEffective({ lineId, productId = null }) {
    const [product, line] = await Promise.all([
      productId ? this.findOneByScope({ lineId, productId }) : null,
      lineId ? this.findOneByScope({ lineId, productId: null }) : null,
    ]);
    return mergePolicy(product, line);
  }
}

Container.set(AgentPolicyRepository, new AgentPolicyRepository());
