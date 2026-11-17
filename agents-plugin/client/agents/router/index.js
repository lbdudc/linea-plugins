/**
 * LINEA's router (these pages are routes of it). It is given when the plugin loads, before any page is opened; what asks for it
 * before that is a mistake, and says so.
 */
let router = null;

export const setRouter = (instance) => { router = instance; };

export default new Proxy({}, {
  get: (_, key) => {
    if (!router) throw new Error('the agents pages were used before the plugin loaded');
    const value = router[key];
    return typeof value === 'function' ? value.bind(router) : value;
  },
});
