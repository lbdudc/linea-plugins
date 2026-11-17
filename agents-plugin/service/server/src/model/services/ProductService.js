import { Container } from 'typedi';
import { linea } from '../../linea/LineaClient.js';

const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;

/** What agents does with products, done through LINEA's REST API as `userId`. */
export default class ProductService {
  /**
   * Generates the product (LINEA does it, logs it and tells the person's open pages). Resolves what LINEA answers:
   * the product, with `conflicts` and `stage` when the generation did not merge cleanly.
   */
  generateProduct = async ({ id, userId, bump }) =>
    linea.post(`/api/products/${id}/generate`, bump ? { bump } : {}, { userId, timeoutMs: GENERATION_TIMEOUT_MS });

  /** Saves the feature selection of a product as feature names; LINEA makes the model of it and the spec follows. */
  saveSelection = async ({ id, userId, features }) => linea.put(`/api/products/${id}/selection`, { features }, { userId });
}

Container.set(ProductService, new ProductService());
