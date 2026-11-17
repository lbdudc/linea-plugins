import { Container } from 'typedi';
import { validateFeatureSelection } from '../../linea/featureModel.js';
import ProductService from '../../model/services/ProductService.js';
import ProductSpecService, { ProductSpecUnavailableError } from '../../model/services/ProductSpecService.js';
import { productAccess } from './git.js';
import { normalizeFeatureSelection } from './splContext.js';

/**
 * Tools for the Evolution agent (feature-model change safety).
 *
 * Deterministic core: `validateSpecPatch` — a proposed feature selection is only
 * applied if `completeFeatureSelection` accepts it under the current model. Claude
 * proposes the patch; this decides whether it is real.
 */

/**
 * Classify each product's impact when moving from the current model to a proposed
 * one: breaking (valid→invalid), fixing (invalid→valid), or unaffected.
 * The deterministic preview behind impact-mode.
 */
export const classifyImpact = ({ currentModel, proposedModel, products }) => {
  const admits = (model, features) => validateFeatureSelection({ model, features }).valid;

  return products.map((p) => {
    const features = normalizeFeatureSelection({ spec: p.spec });
    const cur = admits(currentModel, features);
    const prop = admits(proposedModel, features);
    let impact;
    if (cur && !prop) impact = 'breaking';
    else if (!cur && prop) impact = 'fixing';
    else if (cur && prop) impact = 'unaffected_valid';
    else impact = 'unaffected_invalid';
    return {
      productId: String(p._id),
      name: p.spec?.basicData?.name ?? String(p._id),
      version: p.spec?.basicData?.version ?? '?',
      features,
      impact,
    };
  });
};

export const validateSpecPatch = ({ model, features }) => {
  const { valid, error } = validateFeatureSelection({ model, features });
  return { valid, reason: valid ? null : error };
};

/**
 * Apply a validated feature-selection patch to a product (preserving the rest of
 * its spec). Goes through ProductService.updateProduct, so it enforces access and
 * bumps the version exactly like a normal edit.
 */
export const applySpecPatch = async ({ productId, features, userId }) => {
  const { product } = await productAccess({ productId, userId });
  if (!product) throw new Error(`Product not found: ${productId}`);

  const { reason } = await Container.get(ProductSpecService).getSpecFromHostOrCache({
    productProjectId: product.repo.id, fallbackSpec: product.spec, userId,
    context: `evolution.applySpecPatch: product ${productId}`,
  });

  if (reason === 'infra') {
    throw new ProductSpecUnavailableError(
      `No se pudo leer el spec del producto ${productId} en el host git, así que no se sabe cuál es su spec real. ` +
      'El parche de features se cancela para no escribir un spec basado en una caché posiblemente obsoleta. ' +
      'Reintenta cuando el host git responda.'
    );
  }

  return Container.get(ProductService).saveSelection({ id: productId, features, userId });
};
