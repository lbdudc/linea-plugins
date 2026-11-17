import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';
import type { LoginResponse } from './types.js';

/**
 * What one HTTP request to the MCP server brings: where LINEA is and who the caller is. Inside `requestContext.run`, every call to LINEA
 * is made as that caller (their `Authorization`, and the git host that vouches for a git token); outside it (stdio) the environment is used.
 */
export interface RequestContext {
  baseUrl: string;
  authorization: string;
  gitHost?: string;
}
export const requestContext = new AsyncLocalStorage<RequestContext>();

let currentJwt: string | undefined;
const jwt = (): string => (currentJwt ??= config.SPLALM_JWT);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class SplalmError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(
    status: number,
    body: { message?: string; error?: string } & Record<string, unknown>,
  ) {
    super(body['message'] ?? `HTTP ${status}`);
    this.name = 'SplalmError';
    this.status = status;
    this.code = (body['error'] as string | undefined) ?? 'UNKNOWN_ERROR';
    this.details = body;
  }
}

// ---------------------------------------------------------------------------
// Actionable error formatter
// ---------------------------------------------------------------------------

export function handleApiError(error: unknown): string {
  if (error instanceof SplalmError) {
    switch (error.status) {
      case 400:
        return `Error: Bad request — ${error.message}. Check your input parameters.`;
      case 401:
        return requestContext.getStore()
          ? 'Error: Unauthorized. LINEA did not accept the credentials of this connection (the Authorization header of the MCP client).'
          : 'Error: Unauthorized. Your session has expired — update SPLALM_JWT in .env and restart.';
      case 403:
        return 'Error: Permission denied. You need a higher access level on the git host (maintainer=40, owner=50) for this operation.';
      case 404:
        return `Error: Not found — ${error.message}. Verify the product_id or that SPL_LINE_ID is correct.`;
      case 409:
        return `Error: Conflict — ${error.message}. A resource with that name may already exist.`;
      case 422:
        return `Error: Validation failed — ${error.message}. Check that spec.basicData.name uses only alphanumeric/_/-/. chars and version follows x.y.z.`;
      default:
        return `Error: SPLALM returned HTTP ${error.status} — ${error.message}.`;
    }
  }
  if (error instanceof Error) {
    if (error.message.includes('ECONNREFUSED')) {
      return `Error: Cannot reach LINEA at ${requestContext.getStore()?.baseUrl ?? config.SPLALM_BASE_URL}. Make sure the server is running.`;
    }
    if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
      return 'Error: Request timed out. synchronize_product can take several minutes — increase client timeout.';
    }
    return `Error: ${error.message}`;
  }
  return `Error: Unexpected error — ${String(error)}`;
}

/** A LINEA session, or the git token of an account (with the host that vouches for it, when not the primary one). */
export function authHeaders(): Record<string, string> {
  const ctx = requestContext.getStore();
  if (ctx) {
    return {
      'Content-Type': 'application/json',
      'Authorization': ctx.authorization,
      ...(ctx.gitHost ? { 'X-Git-Host': ctx.gitHost } : {}),
    };
  }
  if (config.SPLALM_GIT_TOKEN) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `GitToken ${config.SPLALM_GIT_TOKEN}`,
      ...(config.SPLALM_GIT_HOST ? { 'X-Git-Host': config.SPLALM_GIT_HOST } : {}),
    };
  }
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt()}` };
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

async function apiRequest(
  method: string,
  urlPath: string,
  body?: unknown,
  opts: { text?: boolean; binary?: boolean } = {},
  isRetry = false,
): Promise<unknown> {
  const url = `${requestContext.getStore()?.baseUrl ?? config.SPLALM_BASE_URL}${urlPath}`;
  const init: RequestInit = {
    method,
    headers: authHeaders(),
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(url, init);

  if (res.status === 401 && !isRetry && !config.SPLALM_GIT_TOKEN && !requestContext.getStore()) {
    const refreshed = await doRefresh();
    if (refreshed) return apiRequest(method, urlPath, body, opts, true);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as Record<
      string,
      unknown
    >;
    throw new SplalmError(
      res.status,
      err as { message?: string; error?: string } & Record<string, unknown>,
    );
  }

  if (res.status === 204) return null;
  if (opts.binary) {
    const buf = await res.arrayBuffer();
    const contentDisposition = res.headers.get('content-disposition') ?? '';
    const match = contentDisposition.match(/filename="([^"]+)"/);
    return { buffer: Buffer.from(buf), filename: match?.[1] ?? 'download.zip' };
  }
  return opts.text ? res.text() : res.json();
}

// ---------------------------------------------------------------------------
// JWT auto-refresh
// ---------------------------------------------------------------------------

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${config.SPLALM_BASE_URL}/api/users/loginFromServiceToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt()}`,
      },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as LoginResponse;
    currentJwt = data.token;
    scheduleRefresh();
    return true;
  } catch {
    return false;
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Proactively refresh 10 min before the 6900s (~115 min) JWT expiry
  refreshTimer = setTimeout(() => {
    void doRefresh();
  }, (6900 - 600) * 1000);
  refreshTimer.unref();
}

export function startAutoRefresh(): void {
  // (a git token does not expire with a session: nothing to renew)
  if (!config.SPLALM_GIT_TOKEN) scheduleRefresh();
}

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Utility: cast any value to the Record<string,unknown> shape that the MCP SDK
// requires for structuredContent (TypeScript index-signature rule).
// ---------------------------------------------------------------------------

export function toStructured(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

export const splalm = {
  get:       (p: string)              => apiRequest('GET',    p),
  post:      (p: string, b?: unknown) => apiRequest('POST',   p, b),
  put:       (p: string, b?: unknown) => apiRequest('PUT',    p, b),
  patch:     (p: string, b?: unknown) => apiRequest('PATCH',  p, b),
  delete:    (p: string)              => apiRequest('DELETE', p),
  getBinary: (p: string, b?: unknown) =>
    apiRequest('POST', p, b, { binary: true }) as Promise<{ buffer: Buffer; filename: string }>,
};
