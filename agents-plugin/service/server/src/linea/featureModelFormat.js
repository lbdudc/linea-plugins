import { linea } from './LineaClient.js';
import { readFile } from './repo.js';

/**
 * Agents thinks of a feature model as UVL. LINEA keeps it as a model of its feature metamodel, in a file of the line's repository.
 * These two are the only places that know the difference: both go through LINEA, which has the metamodel.
 */

/** Where a line keeps its feature model in its repository. */
export const FEATURE_MODEL_PATH = 'models/featuremodel.featuremodel';

/** UVL → the text a line keeps its feature model in (what is committed to FEATURE_MODEL_PATH). */
export const toLineaFeatureModel = async ({ lineId, userId, uvl }) => {
  const { text } = await linea.post(`/api/lines/${lineId}/model/from-uvl`, { uvl }, { userId });
  return text;
};

/** The text of a line's feature model (as committed to FEATURE_MODEL_PATH, on any branch) → UVL. */
export const fromLineaFeatureModel = async ({ lineId, userId, text }) => {
  const { uvl } = await linea.post(`/api/lines/${lineId}/model/preview`, { content: text }, { userId });
  return uvl;
};

/** The feature model of a line as it is in the git host at `ref` (a branch, default main), as UVL. */
export const readFeatureModelUvl = async ({ lineProjectId, lineId, userId, ref = 'main' }) => {
  const text = await readFile({ id: lineProjectId, userId, path: FEATURE_MODEL_PATH, ref });
  if (text === null) throw new Error(`The line has no feature model at ${FEATURE_MODEL_PATH} on ${ref}`);
  return fromLineaFeatureModel({ lineId, userId, text });
};
