import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who the code is acting for. LINEA is reached as a person (what the call can do is what they can), so every call to it needs to know whose: an HTTP
 * request runs as the user it authenticated, a run as the user who created it. Code that has the id at hand passes it explicitly; the
 * data layer (the repositories and services that talk to LINEA) falls back to this.
 */
const store = new AsyncLocalStorage();

export const runAs = (userId, fn) => store.run({ userId: userId == null ? null : String(userId) }, fn);

export const actingUserId = () => store.getStore()?.userId ?? null;
