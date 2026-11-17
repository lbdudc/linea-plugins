import { loadingStore } from '../stores/loadingStore.js';

/**
 * How these pages reach the agents: through LINEA, with the session of the person (the app's axios instance, `ui.api`). LINEA's server
 * passes the call on to the agents' service as that person (see agents-plugin/server). There is no token and no login here.
 */
let client = null;

/** The plugin gives the app's axios instance when it loads. */
export const setClient = (instance) => { client = instance; };

// the plugin's door on LINEA's API, and what the agents' API is under it
const DOOR = '/plugins/agents-plugin/api';

const call = (prefix, method, args) => {
  if (!client) throw new Error('the agents pages were used before the plugin loaded');
  loadingStore.start();
  const [url, ...rest] = args;
  return Promise.resolve(client[method](`${prefix}${url}`, ...rest)).finally(() => loadingStore.stop());
};

/** An axios-like client (get, post, put, patch, delete) for the agents' API under `sub` (`/agents`, `/agents/linea`...). */
export const makeApi = (sub = '') => {
  const prefix = `${DOOR}${sub}`;
  return {
    get: (...args) => call(prefix, 'get', args),
    post: (...args) => call(prefix, 'post', args),
    put: (...args) => call(prefix, 'put', args),
    patch: (...args) => call(prefix, 'patch', args),
    delete: (...args) => call(prefix, 'delete', args),
  };
};

// agents' own calls are `/agents/...` (what the service answers under `/api`)
const api = makeApi('');

export { api };
export default api;
