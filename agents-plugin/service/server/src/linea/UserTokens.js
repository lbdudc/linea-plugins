import { lineaRequest } from './LineaClient.js';

/**
 * The git host token of the person agents act for. Agents has no login of its own: LINEA holds the person's host token (and renews it),
 * and gives it to agents when agents ask for it as that person (`GET /api/users/git-credentials`). It is kept for a moment, not stored.
 */
const TTL_MS = 60_000;
const cache = new Map(); // userId -> { token, expiresAt }
const pending = new Map(); // userId -> Promise<string>

const fetchToken = async (userId) => {
  const credentials = await lineaRequest({ userId, // (the agents speak to GitLab only: the token of that host, whatever remote the person is working on in LINEA)
    path: '/api/users/git-credentials?host=gitlab' });
  if (!credentials?.token) throw new Error(`LINEA gave no git host token for ${userId}`);
  cache.set(String(userId), { token: credentials.token, expiresAt: Date.now() + TTL_MS });
  return credentials.token;
};

export const getAccessToken = async (userId) => {
  const hit = cache.get(String(userId));
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  return refreshAccessToken(userId);
};

/** Asks LINEA again (it renews the token first). One ask at a time per person. */
export const refreshAccessToken = (userId) => {
  const key = String(userId);
  if (!pending.has(key)) pending.set(key, fetchToken(key).finally(() => pending.delete(key)));
  return pending.get(key);
};

export const forgetTokens = () => { cache.clear(); pending.clear(); };
