import { Container } from 'typedi';
import { makeGitlabSession, properties } from '../../model/connectors/properties.js';
import { getAccessToken } from '../../linea/UserTokens.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';
import LineRepository from '../../model/repositories/LineRepository.js';
import PermissionChecker from '../../model/services/PermissionChecker.js';
import {
  getMergeRequests,
  getMergeRequestChanges,
  compareBranches,
  getBranchCommits,
  postMergeRequestComment,
} from '../../model/connectors/gitlabClient.js';

/**
 * The agents' GitLab tool surface. Token acquisition reuses the exact permission
 * path the existing ProductService methods use, so an agent never has more access
 * than the user who triggered it.
 */

export const branches = {
  base: properties.gitlab.baseBranch, // bigbang
  default: properties.gitlab.defaultBranch, // main
  generation: properties.gitlab.generationBranch,
};

/**
 * Resolve { product, line, token, projectId } for a product, enforcing the given
 * GitLab access level (default 20 = reporter, matching ProductService reads).
 */
export const productGitlabAccess = async ({ productId, userId, accessLevel = 20 }) => {
  const product = await Container.get(ProductRepository).findById(productId, { userId });
  if (!product) throw new Error('Product not found');

  const gitlabSession = makeGitlabSession();
  const user = await Container.get(PermissionChecker).checkUserExistsAndHasPrivileges(
    { userId, repoId: product.repo.id, accessLevel },
    gitlabSession
  );
  const line = await Container.get(LineRepository).findById(product.lineId, { userId });

  return {
    product,
    line,
    token: await getAccessToken(userId),
    projectId: product.repo.id,
  };
};

/**
 * Resolve { token, lineProjectId } for a line, enforcing line write access
 * (default 30 = developer) — used before harvesting into the line repo.
 */
export const lineGitlabAccess = async ({ lineId, lineProjectId, userId, accessLevel = 30 }) => {
  let projectId = lineProjectId;
  if (!projectId && lineId) {
    const line = await Container.get(LineRepository).findById(lineId, { userId });
    projectId = line?.repoId;
  }
  const gitlabSession = makeGitlabSession();
  const user = await Container.get(PermissionChecker).checkUserExistsAndHasPrivileges(
    { userId, repoId: projectId, accessLevel },
    gitlabSession
  );
  void user;
  return { token: await getAccessToken(userId), lineProjectId: projectId };
};

export {
  getMergeRequests,
  getMergeRequestChanges,
  compareBranches,
  getBranchCommits,
  postMergeRequestComment,
};
