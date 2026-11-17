import { Container } from 'typedi';
import { linea } from '../../linea/LineaClient.js';

/** Products as LINEA has them. Reads only (see LineRepository). A product that is not there, or that the acting user cannot see, is `null`. */
const orNull = async (promise) => {
  try {
    return await promise;
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) return null;
    throw error;
  }
};

export default class ProductRepository {
  async findById(id, { userId } = {}) {
    return orNull(linea.get(`/api/products/${id}`, { userId, query: { brief: 1 } }));
  }

  async findByLineId(lineId, { userId } = {}) {
    return linea.get(`/api/lines/${lineId}/products`, { userId });
  }

  async findByRepoId(projectId, { userId, host } = {}) {
    return orNull(linea.get(`/api/products/by-git-project/${projectId}`, { userId, query: { host } }));
  }
}

Container.set(ProductRepository, new ProductRepository());
