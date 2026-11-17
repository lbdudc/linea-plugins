import { Container } from 'typedi';
import { linea } from '../../linea/LineaClient.js';
import { LineaUnreachableError } from '../../linea/errors.js';

/**
 * The spec of a product: its name, version, data model and the features it selects. LINEA keeps it in the product's repository and is the
 * only one that reads or writes that file; agents asks LINEA, and changes the selection through `ProductService.saveSelection`.
 */

export class ProductSpecFileError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ProductSpecFileError';
  }
}

export class ProductSpecUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ProductSpecUnavailableError';
  }
}

export const logSpecReadFallback = (context, reason, error) => {
  if (reason === 'infra') {
    console.error(
      `[productSpec] SPEC FROM CACHE (infra) — ${context}: LINEA could not read the spec of the product from the git host ` +
      '(network, permissions, or the host is down) — serving the spec LINEA has stored, which may be out of date. ' +
      'This is NOT "product with no spec file yet": it is an infrastructure failure, check connectivity and permissions:',
      error?.message ?? error,
    );
    return;
  }
  if (reason === 'corrupt') {
    console.warn(`[productSpec] SPEC FROM CACHE (corrupt) — ${context}: the spec file is not a valid spec; serving the stored one:`, error?.message ?? error);
    return;
  }
  console.info(`[productSpec] SPEC FROM CACHE (absent) — ${context}: the product has no spec file yet — serving the stored spec.`);
};

export const logSpecWriteFailure = (context, error) => {
  console.error(`[productSpec] ${context}:`, error?.message ?? error);
};

export default class ProductSpecService {
  /**
   * The spec of the product made in a git project, as the git host has it (`source: 'repo'`) or, when LINEA could not read it there,
   * the stored one it falls back to (`source: 'mongo'`, with the `reason`: `absent`, `corrupt` or `infra`). `fallbackSpec` is what to
   * serve when LINEA itself cannot be reached.
   */
  getSpecFromHostOrCache = async ({ productProjectId, fallbackSpec, context, userId }) => {
    let product;
    try {
      product = await linea.get(`/api/products/by-git-project/${productProjectId}`, { userId, query: { spec: 1 } });
    } catch (error) {
      if (error instanceof LineaUnreachableError || error?.status >= 500) {
        logSpecReadFallback(context, 'infra', error);
        return { spec: fallbackSpec, source: 'mongo', reason: 'infra' };
      }
      throw error;
    }
    if (product.specSource === 'repo') return { spec: product.spec, source: 'repo', reason: null };
    const reason = product.specReason ?? 'absent';
    logSpecReadFallback(context, reason);
    return { spec: product.spec ?? fallbackSpec, source: 'mongo', reason };
  };
}

Container.set(ProductSpecService, new ProductSpecService());
