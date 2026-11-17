import { Container } from 'typedi';
import { linea } from '../../linea/LineaClient.js';

/** The generation logs of a product, as LINEA keeps them (agents never writes them: LINEA logs every generation it runs). */
export default class LogRepository {
  async findByProductIdAndVersionOrderByCreatedAtAsc(productId, version, { userId } = {}) {
    const logs = await linea.get(`/api/logs/${productId}/${version}`, { userId });
    return [...(logs ?? [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
}

Container.set(LogRepository, new LogRepository());
