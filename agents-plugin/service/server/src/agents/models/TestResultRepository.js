import { Container } from 'typedi';
import MongooseRepository from '../../model/repositories/MongooseRepository.js';
import TestResult from './TestResult.js';

export default class TestResultRepository extends MongooseRepository {
  constructor() {
    super(TestResult);
  }

  // The most recent test result per product in a line — powers the board's
  // per-product test chip. One row per product (the latest).
  async findLatestByLineId(lineId) {
    return await this.model.aggregate([
      { $match: { lineId: new this.model.base.Types.ObjectId(String(lineId)) } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$productId', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
    ]);
  }

  // Full history for one product, newest first.
  async findByProductId(productId, { limit = 20 } = {}) {
    return await this.model.find({ productId }).sort({ createdAt: -1 }).limit(limit);
  }
}

Container.set(TestResultRepository, new TestResultRepository());
