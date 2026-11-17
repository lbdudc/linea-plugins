import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// no credentials in the environment: the HTTP server has none, each request brings its own
delete process.env['SPLALM_JWT'];
delete process.env['SPLALM_GIT_TOKEN'];
delete process.env['SPL_LINE_ID'];
const { createHttpServer } = await import('../src/http.js');

type Seen = { url: string; authorization?: string; gitHost?: string };
const seen: Seen[] = [];
let linea: http.Server;
let mcp: http.Server;
let mcpUrl = '';

const listen = (server: http.Server): Promise<string> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

before(async () => {
  // a LINEA that knows one line, and accepts one token
  linea = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', authorization: req.headers['authorization'], gitHost: req.headers['x-git-host'] as string | undefined });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['authorization'] !== 'GitToken good') { res.statusCode = 401; return void res.end('{"error":"error_messages.incorrect_credentials"}'); }
    if (req.url === '/api/lines/line-1') return void res.end(JSON.stringify({ _id: 'line-1', name: 'Shop', version: '1.2.0', description: 'A shop', webUrl: 'http://git/shop', models: [], products: [], members: [{ username: 'ada', role: 40 }] }));
    res.statusCode = 404;
    res.end('{"message":"Not found"}');
  });
  const lineaUrl = await listen(linea);
  mcp = createHttpServer({ lineaUrl });
  mcpUrl = await listen(mcp);
});
after(() => { linea.close(); mcp.close(); });

const connect = async (path: string, headers: Record<string, string>): Promise<Client> => {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${mcpUrl}${path}`), { requestInit: { headers } }));
  return client;
};

test('health is up without credentials, and the home page says how to connect', async () => {
  assert.equal((await fetch(`${mcpUrl}/health`)).status, 200);
  const page = await (await fetch(`${mcpUrl}/`)).text();
  assert.match(page, /\/mcp\/&lt;line id&gt;/);
});

test('a connection without credentials is refused, and says what to send', async () => {
  const res = await fetch(`${mcpUrl}/mcp/line-1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') ?? '', /Bearer/);
});

test('credentials LINEA does not accept are refused at the first message', async () => {
  await assert.rejects(connect('/mcp/line-1', { Authorization: 'GitToken bad' }), /401|Unauthorized/);
});

test('a line that is not there is a 404', async () => {
  await assert.rejects(connect('/mcp/nope', { Authorization: 'GitToken good' }), /404|Not found/);
});

test('the tools of the line are offered, and each call to LINEA is made as the caller', async () => {
  seen.length = 0;
  const client = await connect('/mcp/line-1', { Authorization: 'GitToken good', 'X-Git-Host': 'local' });
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'splalm_get_spl_info'));
  const result = await client.callTool({ name: 'splalm_get_spl_info', arguments: { response_format: 'json' } });
  assert.match(JSON.stringify(result.content), /Shop/);
  const calls = seen.filter((s) => s.url === '/api/lines/line-1');
  assert.ok(calls.length >= 2, 'the check at the first message, and the tool');
  for (const call of calls) assert.deepEqual([call.authorization, call.gitHost], ['GitToken good', 'local']);
  await client.close();
});

test('?readonly=true leaves out the tools that change something', async () => {
  const writable = await connect('/mcp/line-1', { Authorization: 'GitToken good' });
  const readonly = await connect('/mcp/line-1?readonly=true', { Authorization: 'GitToken good' });
  const names = async (c: Client): Promise<Set<string>> => new Set((await c.listTools()).tools.map((t) => t.name));
  const all = await names(writable);
  const some = await names(readonly);
  assert.ok(some.size > 0 && some.size < all.size, `${some.size} of ${all.size}`);
  for (const name of some) assert.ok(all.has(name));
  assert.ok([...all].some((n) => !some.has(n) && /create|update|delete|generate|synchronize/.test(n)));
  await writable.close();
  await readonly.close();
});

test('two callers at the same time do not see each other\'s credentials', async () => {
  seen.length = 0;
  const a = await connect('/mcp/line-1', { Authorization: 'GitToken good', 'X-Git-Host': 'local' });
  const b = await connect('/mcp/line-1', { Authorization: 'GitToken good', 'X-Git-Host': 'gitlab' });
  await Promise.all([1, 2, 3].flatMap(() => [a, b].map((c) => c.callTool({ name: 'splalm_get_spl_info', arguments: { response_format: 'json' } }))));
  const hosts = new Set(seen.map((s) => s.gitHost));
  assert.deepEqual([...hosts].sort(), ['gitlab', 'local']);
  await a.close();
  await b.close();
});
