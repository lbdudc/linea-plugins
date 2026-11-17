import { actingUserId } from './actingUser.js';
import { LineaApiError, LineaUnreachableError, NoActingUserError } from './errors.js';
import { usernameOf } from './people.js';

/**
 * The one way agents reach LINEA: its REST API, as the person the call is for. Agents is a service of LINEA (a plugin's): it presents
 * the key LINEA gave it (`Authorization: Service <key>`) and says who it acts for (`X-Act-As: <username>`), so what a call can do is
 * what that person can.
 */
export const lineaBaseUrl = () => (process.env.LINEA_API_URL ?? '').replace(/\/+$/, '');

const DEFAULT_TIMEOUT_MS = 30_000;

const urlOf = (path, query) => {
  const base = lineaBaseUrl();
  if (!base) throw new Error('LINEA_API_URL is not set: agents does not know where LINEA is');
  const params = Object.entries(query ?? {}).filter(([, value]) => value !== undefined && value !== null);
  const search = params.length ? `?${new URLSearchParams(params.map(([key, value]) => [key, String(value)]))}` : '';
  return `${base}${path}${search}`;
};

const serviceKey = () => {
  const key = process.env.AGENTS_SERVICE_KEY;
  if (!key) throw new Error('AGENTS_SERVICE_KEY is not set: agents cannot act on LINEA');
  return key;
};

const send = async ({ url, method, username, body, timeoutMs }) => {
  try {
    return await fetch(url, {
      method,
      headers: {
        Authorization: `Service ${serviceKey()}`,
        'X-Act-As': username,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new LineaUnreachableError(`LINEA is not reachable (${method} ${url}): ${cause?.message ?? cause}`, { cause });
  }
};

const parse = async (res) => {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
};

/** Calls LINEA. `userId` is the person it is for (default: the one the current request or run acts as). */
export const lineaRequest = async ({ userId, method = 'GET', path, query, body, timeoutMs = DEFAULT_TIMEOUT_MS, binary = false }) => {
  const who = userId ?? actingUserId();
  if (who === null || who === undefined) throw new NoActingUserError();
  const url = urlOf(path, query);

  const res = await send({ url, method, username: await usernameOf(who), body, timeoutMs });

  // (`binary`: a file, as a Buffer; an error is still read as text)
  const payload = binary && res.ok ? Buffer.from(await res.arrayBuffer()) : await parse(res);
  if (!res.ok) {
    const detail = payload?.error ?? payload?.detail ?? (typeof payload === 'string' ? payload.slice(0, 200) : '');
    throw new LineaApiError(`LINEA ${method} ${path} → ${res.status}${detail ? ` (${detail})` : ''}`, { status: res.status, body: payload, path });
  }
  return payload;
};

export const linea = {
  get: (path, options = {}) => lineaRequest({ ...options, method: 'GET', path }),
  post: (path, body, options = {}) => lineaRequest({ ...options, method: 'POST', path, body: body ?? {} }),
  put: (path, body, options = {}) => lineaRequest({ ...options, method: 'PUT', path, body: body ?? {} }),
  patch: (path, body, options = {}) => lineaRequest({ ...options, method: 'PATCH', path, body: body ?? {} }),
};
