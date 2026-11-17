import { Container } from 'typedi';
import { linea } from '../../linea/LineaClient.js';
import { LineNotFoundError } from '../errors/errors.js';
import { toLineaFeatureModel } from '../../linea/featureModelFormat.js';
import { ProductSpecUnavailableError } from './ProductSpecService.js';

/**
 * What agents does with lines, done through LINEA's REST API as `userId`. LINEA keeps the lines, their repositories and their
 * permission rules; this class only asks.
 */
export default class LineService {
  findLineById = async ({ id, userId }) => {
    try {
      return await linea.get(`/api/lines/${id}`, { userId, query: { brief: 1 } });
    } catch (error) {
      if (error?.status === 404) throw new LineNotFoundError(`Line not found: ${id}`);
      throw error;
    }
  };

  findEnrolledLines = async ({ userId }) => linea.get('/api/lines/enrolled', { userId });

  /**
   * The feature model of a line as a file in UVL (what the analysis works on), the shape agents has always read it in:
   * `{ content, encoding, featureModelType }`.
   */
  getFeatureModel = async ({ id, userId }) => {
    const model = await linea.get(`/api/lines/${id}/model`, { userId });
    if (typeof model?.uvl !== 'string') throw new Error(`LINEA did not give the feature model of line ${id} as UVL`);
    return { content: model.uvl, encoding: 'utf8', featureModelType: 'UVL', version: model.version };
  };

  /** The products of a line with their spec as the git host has it. `cutOnInfra`: fail rather than serve a stored spec when it cannot be read. */
  findProductsByLineId = async ({ id, userId, specFromRepo = false, cutOnInfra = false }) => {
    try {
      return await linea.get(`/api/lines/${id}/products`, { userId, query: { spec: specFromRepo ? 1 : undefined, cut: cutOnInfra ? 1 : undefined } });
    } catch (error) {
      // LINEA refuses to serve a stored spec when asked not to (`cut`) and the git host cannot be read
      if (error?.status === 503 && error.body?.error === 'error_messages.product_spec_unavailable') {
        throw new ProductSpecUnavailableError(`The spec of a product of line ${id} could not be read from the git host: the operation is cut`, { cause: error });
      }
      throw error;
    }
  };

  /** Saves the feature model (given as UVL) on `main`; LINEA checks it and raises the version when it changed. */
  saveFeatureModel = async ({ id, userId, content, bump = 'minor' }) => {
    const text = await toLineaFeatureModel({ lineId: id, userId, uvl: content });
    return linea.put(`/api/lines/${id}/model`, { content: text, bump }, { userId });
  };

  /** Commits files to a plan branch. */
  commitToPlanBranch = async ({ id, userId, branch, actions, message }) =>
    linea.post(`/api/lines/${id}/plan-branch/commits`, { branch, actions, message }, { userId });

  /** Merges a plan branch into main. Resolves `{ merged, conflicts, mrIid }`. */
  mergePlanBranch = async ({ id, userId, branch, title }) =>
    linea.post(`/api/lines/${id}/plan-branch/merge`, { branch, title }, { userId, timeoutMs: 200_000 });
}

Container.set(LineService, new LineService());
