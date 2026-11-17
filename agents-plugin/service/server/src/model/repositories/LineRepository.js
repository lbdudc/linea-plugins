import { Container } from 'typedi';
import { linea } from '../../linea/LineaClient.js';

/**
 * Lines as LINEA has them. Reads only: LINEA owns them, and agents asks for them as the person it acts for (see `actingUser.js`).
 * Like a database lookup, one that is not there is `null`.
 */
const orNull = async (promise) => {
  try {
    return await promise;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
};

export default class LineRepository {
  async findById(id, { userId } = {}) {
    return orNull(linea.get(`/api/lines/${id}`, { userId, query: { brief: 1 } }));
  }

  /** The lines the acting user is a member of. */
  async getAll({ userId } = {}) {
    return linea.get('/api/lines/enrolled', { userId });
  }
}

Container.set(LineRepository, new LineRepository());
