import { Container } from 'typedi';
import { assertFeatureSelection, normalizeProductSpec } from '../../linea/featureModel.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';
import LineService from '../../model/services/LineService.js';
import ProductSpecService, { ProductSpecUnavailableError } from '../../model/services/ProductSpecService.js';
import { loadFeatureModel, normalizeFeatureSelection } from '../tools/splContext.js';
import { validateModelAgainstProducts } from '../tools/harvest.js';

/**
 * Validate a product's current feature selection against the line's feature model,
 * using the same completeFeatureSelection path that generateProduct relies on.
 * Returns a result object safe to embed in proposal.body.validation.fm.
 */
/** Convert validateModelAgainstProducts output to the { valid, violations, checkedAt } shape. */
export const normalizeHarvestFmResult = (raw) => ({
  valid: raw?.valid ?? false,
  violations: raw?.parseError
    ? [raw.parseError]
    : (raw?.broken ?? []).map((b) => `${b.name}: ${b.reason}`),
  checkedAt: new Date(),
});

/** Re-run harvest FM validation and return the same shape as validateProductFm. */
export const validateHarvestFm = async ({ lineId, userId, newModelUvl }) => {
  if (!newModelUvl) return { valid: null, violations: [], checkedAt: new Date() };
  const products = await Container.get(LineService).findProductsByLineId({ id: lineId, userId, specFromRepo: true });
  try {
    const { valid, broken } = validateModelAgainstProducts({ modelContent: newModelUvl, type: 'UVL', products });
    return normalizeHarvestFmResult({ valid, broken });
  } catch (err) {
    return { valid: false, violations: [err?.message ?? String(err)], checkedAt: new Date() };
  }
};

export const validateProductFm = async ({ productId, userId, cutOnInfra = false }) => {
  try {
    const product = await Container.get(ProductRepository).findById(productId);
    if (!product) return { valid: false, violations: ['Product not found'], checkedAt: new Date() };
    const lineId = String(product.lineId);

    const { spec: resolvedSpec, source, reason } = await Container.get(ProductSpecService).getSpecFromHostOrCache({
      productProjectId: product.repo?.id, fallbackSpec: product.spec, userId,
      context: `syncValidation.validateProductFm: product ${productId}`,
    });
    if (cutOnInfra && reason === 'infra') {
      throw new ProductSpecUnavailableError(
        `No se pudo leer el spec del producto ${productId} on the git host, así que no se sabe si su spec ` +
        'sigue siendo válido bajo el modelo actual. Se cancela la resolución de sync para no comprometer ficheros ' +
        'sobre un veredicto que no se pudo verificar. Reintenta cuando el host git responda.'
      );
    }
    const spec = source === 'repo' ? normalizeProductSpec({ spec: resolvedSpec }) : resolvedSpec;

    const features = normalizeFeatureSelection({ spec });
    const { model } = await loadFeatureModel({ lineId, userId });
    assertFeatureSelection({ model, features });
    return { valid: true, violations: [], checkedAt: new Date() };
  } catch (err) {
    if (err instanceof ProductSpecUnavailableError) throw err;
    return { valid: false, violations: [err?.message ?? String(err)], checkedAt: new Date() };
  }
};
