#!/usr/bin/env node
/**
 * The MCP server over HTTP (streamable HTTP, stateless): the service of the `mcp-plugin` of LINEA.
 *
 *   POST|GET|DELETE /mcp/<lineId>[?readonly=true]   one MCP endpoint per line
 *   GET /health                                       200 when it is up (what LINEA's Plugins view asks)
 *   GET /                                             a page that says how to connect a client
 *
 * It holds no credentials: whoever connects brings them in `Authorization` (`Bearer <session>` or `GitToken <token>`, with
 * `X-Git-Host` when the host is not the primary one), and every call to LINEA is made as that person, so they can do through
 * an AI client exactly what they can do in LINEA. LINEA's address is `LINEA_API_URL` (default http://localhost:3000).
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requestContext, splalm, handleApiError } from './client.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';

export interface HttpOptions {
  /** LINEA's server, where the tools send their requests. */
  lineaUrl: string;
  /** Without the tools that change anything, whatever the URL says. */
  readOnly?: boolean;
  /** The address people use to reach this service (shown in the home page). */
  publicUrl?: string;
}

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const readBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const rpcError = (res: http.ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void =>
  json(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null }, headers);

const home = (publicUrl: string): string => `<!doctype html><meta charset="utf-8"><title>LINEA MCP</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1rem}code,pre{background:#f1f5f9;padding:.1rem .3rem;border-radius:4px}pre{padding:.8rem;overflow:auto}</style>
<h1>LINEA MCP</h1>
<p>Use a line of LINEA from an AI client (Claude, Cursor...) over the Model Context Protocol. One endpoint per line:</p>
<pre>${publicUrl}/mcp/&lt;line id&gt;</pre>
<p>Add <code>?readonly=true</code> for the tools that only read. Authenticate with the same credentials as the LINEA API: <code>Authorization: Bearer &lt;session&gt;</code>, or <code>Authorization: GitToken &lt;token&gt;</code> (and <code>X-Git-Host: local|gitlab|github</code> when it is not the primary host). Every tool acts as you.</p>
<p>Claude Code:</p>
<pre>claude mcp add --transport http linea ${publicUrl}/mcp/&lt;line id&gt; \\
  --header "Authorization: GitToken &lt;your token&gt;"</pre>
<p>Clients that only speak stdio can use <code>npx @lbdudc/linea-plugin-mcp</code> instead.</p>`;

export function createHttpServer({ lineaUrl, readOnly = false, publicUrl = 'http://localhost:3333' }: HttpOptions): http.Server {
  const base = lineaUrl.replace(/\/+$/, '');
  return http.createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) rpcError(res, 500, `Internal error: ${error instanceof Error ? error.message : String(error)}`);
      else res.end();
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') return json(res, 200, { status: 'ok', name: SERVER_NAME, version: SERVER_VERSION });
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return void res.end(home(publicUrl));
    }

    const match = /^\/mcp\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return json(res, 404, { error: 'not_found' });
    const lineId = decodeURIComponent(match[1]!);

    const authorization = req.headers['authorization'];
    if (!authorization) {
      return rpcError(res, 401, 'Authorization is required: Bearer <session> or GitToken <token> (and X-Git-Host when it is not the primary host).', {
        'WWW-Authenticate': 'Bearer realm="LINEA"',
      });
    }
    const gitHost = req.headers['x-git-host'];
    const ctx = { baseUrl: base, authorization, ...(typeof gitHost === 'string' && gitHost ? { gitHost } : {}) };

    // stateless: a server and a transport for each request (no session to keep between them)
    if (req.method !== 'POST') return rpcError(res, 405, 'Method not allowed: this server keeps no sessions, use POST.', { Allow: 'POST' });
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      return rpcError(res, 400, 'The body is not JSON.');
    }

    await requestContext.run(ctx, async () => {
      // the first message of a client: say at once when the credentials or the line are not good, instead of failing tool by tool
      if ((body as { method?: string } | undefined)?.method === 'initialize') {
        try {
          await splalm.get(`/api/lines/${encodeURIComponent(lineId)}`);
        } catch (error) {
          const status = (error as { status?: number }).status;
          return rpcError(res, status === 401 || status === 403 || status === 404 ? status : 502, handleApiError(error));
        }
      }
      const server = createMcpServer({ lineId, readOnly: readOnly || url.searchParams.get('readonly') === 'true' });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    });
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env['PORT'] ?? 3333);
  const server = createHttpServer({
    lineaUrl: process.env['LINEA_API_URL'] ?? 'http://localhost:3000',
    readOnly: process.env['MCP_READ_ONLY'] === 'true',
    publicUrl: process.env['MCP_PUBLIC_URL'] ?? `http://localhost:${port}`,
  });
  server.listen(port, () => process.stderr.write(`[linea-mcp] listening on :${port} (LINEA at ${process.env['LINEA_API_URL'] ?? 'http://localhost:3000'})\n`));
}
