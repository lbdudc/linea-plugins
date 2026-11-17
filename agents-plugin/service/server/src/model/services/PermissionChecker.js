import UserRepository from "../repositories/UserRepository.js";
import { PermissionError, UserNotFoundError } from "../errors/errors.js";
import { makeGitlabSession } from "../connectors/properties.js";
import { GitLabAuthError } from "gitlab-commando";
import { Container } from "typedi";
import { getAccessToken } from "../../linea/UserTokens.js";

export default class PermissionChecker {
  userRepository = Container.get(UserRepository);

  checkUserExistsAndHasPrivileges = async ({ userId, repoId, accessLevel }, commando) => {
    const gitlabSession = commando || makeGitlabSession();
      try {
        const user = await this.userRepository.findById(userId);
        if (!user) {
          throw new UserNotFoundError();
        }
  
        const token = await getAccessToken(userId);
        const members = await gitlabSession.getProjectMembers(token, repoId);
  
        const filteredMembers = members.filter(m => m.username === user.username);
  
        if((filteredMembers.length > 0 && filteredMembers[0].access_level >= accessLevel) || user.admin) {
          return user;
        } else {
          throw new PermissionError();
        }
      } catch (error) {
          // An expired/revoked GitLab token must stay a GitLabAuthError so the
          // caller can refresh and retry (and the client gets a 401 GIT_HOST_AUTH
          // instead of a misleading 403).
          if (error instanceof GitLabAuthError || error instanceof UserNotFoundError) throw error;
          console.error("[checkUserExistsAndHasPrivileges] error:", error.constructor.name, error.message);
          throw new PermissionError();
      }
  }

}

Container.set(PermissionChecker, new PermissionChecker());