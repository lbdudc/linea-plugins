import { makeApi } from './http.js';

// LINEA is asked through the agents' service (`/agents/linea/...`), as the person: this page does not talk to LINEA itself
const api = makeApi('/agents/linea');

export default {
  async getFeatureModel(lineId) {
    return (await api.get(`/lines/${lineId}/feature-model`)).data;
  },

  async getLine(lineId) {
    return (await api.get(`/lines/${lineId}`)).data;
  },

  async getProductHealth(productId) {
    return (await api.get(`/products/${productId}/health`)).data;
  },

  async getProductConflicts(productId) {
    return (await api.get(`/products/${productId}/conflicts`)).data;
  },
};
