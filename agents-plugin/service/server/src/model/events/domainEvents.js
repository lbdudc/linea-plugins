import { EventEmitter } from 'node:events';

/**
 * Neutral in-process domain event bus. The model/services layer emits domain
 * events here; any subsystem (e.g. the agents) may subscribe.
 *
 * This keeps the services free of any import of the agent subsystem: the
 * dependency points one way only — agents subscribe to this bus; the bus knows
 * nothing about agents. Remove the agent subscribers and these emits become no-ops.
 */
const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(50);

export const DOMAIN_EVENTS = {
  PRODUCT_GENERATED: 'product:generated',
  // somebody pushed to a repository (LINEA tells it, whatever the host): `{ host, repositoryId, branch?, username }`
  GIT_PUSHED: 'git:pushed',
};

export default domainEvents;
