import { Container } from 'typedi';
import MongooseRepository from '../../model/repositories/MongooseRepository.js';
import HarvestDisposition from './HarvestDisposition.js';

export default class HarvestDispositionRepository extends MongooseRepository {
  constructor() {
    super(HarvestDisposition);
  }

  // All dispositions recorded for a line, newest decision first.
  async findByLine(lineId) {
    return await this.model.find({ lineId }).sort({ decidedAt: -1, updatedAt: -1 });
  }

  // The current disposition for a candidate signature within a line (or null).
  async findBySignature({ lineId, signature }) {
    return await this.model.findOne({ lineId, signature });
  }

  // Upsert a disposition keyed by its stable candidate signature within a line.
  async upsertBySignature({ lineId, signature }, data) {
    return await this.model.findOneAndUpdate(
      { lineId, signature },
      { $set: { ...data, lineId, signature } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }
}

Container.set(HarvestDispositionRepository, new HarvestDispositionRepository());
