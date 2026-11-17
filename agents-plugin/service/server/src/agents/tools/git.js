import { Container } from 'typedi';
import { properties } from '../../model/connectors/properties.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';
import LineRepository from '../../model/repositories/LineRepository.js';

/**
 * The agents' view of the code of lines and products. Everything that reads or writes a repository goes through LINEA (`linea/repo.js`),
 * as the person who triggered the run, so an agent never has more access than they do, and agents never knows which git host it is.
 */

export const branches = {
  base: properties.git.baseBranch, // bigbang
  default: properties.git.defaultBranch, // main
  generation: properties.git.generationBranch,
};

/** `{ product, line, projectId }` for a product the person can see; throws when they cannot (LINEA answers "not found" for both). */
export const productAccess = async ({ productId, userId }) => {
  const product = await Container.get(ProductRepository).findById(productId, { userId });
  if (!product) throw new Error('Product not found');
  const line = await Container.get(LineRepository).findById(product.lineId, { userId });
  return { product, line, projectId: product.repo?.id };
};

/** `{ lineProjectId }` for a line the person can see. */
export const lineAccess = async ({ lineId, lineProjectId, userId }) => {
  if (lineProjectId) return { lineProjectId };
  const line = lineId ? await Container.get(LineRepository).findById(lineId, { userId }) : null;
  if (!line) throw new Error('Line not found');
  return { lineProjectId: line.repoId };
};
