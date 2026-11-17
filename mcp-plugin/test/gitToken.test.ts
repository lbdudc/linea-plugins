import { test } from 'node:test';
import assert from 'node:assert/strict';

// the git token of an account of a LINEA that keeps its repositories itself, and no JWT at all
delete process.env['SPLALM_JWT'];
process.env['SPLALM_GIT_TOKEN'] = 'a'.repeat(64);
process.env['SPLALM_GIT_HOST'] = 'local';
process.env['SPL_LINE_ID'] = 'line-1';
process.env['SPLALM_BASE_URL'] = 'http://linea.test';

const { authHeaders, splalm } = await import('../src/client.js');
const { registerProfileTools } = await import('../src/tools/profile.js');

test('with a git token the requests carry it as GitToken, with the host that vouches for it', () => {
  assert.deepEqual(authHeaders(), { 'Content-Type': 'application/json', Authorization: `GitToken ${'a'.repeat(64)}`, 'X-Git-Host': 'local' });
});

test('a 401 is not retried by renewing a session it does not have', async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => { calls.push(String(url)); return new Response('{"error":"error_messages.incorrect_credentials"}', { status: 401 }); }) as typeof fetch;
  try {
    await assert.rejects(splalm.get('/api/lines/x'));
    assert.deepEqual(calls, ['http://linea.test/api/lines/x']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

type Tool = { name: string; handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }> };
const fakeServer = () => {
  const tools: Tool[] = [];
  return { tools, registerTool: (name: string, _spec: unknown, handler: Tool['handler']) => { tools.push({ name, handler }); } };
};

test('the profile tools: both when it can write, only the reading one when it is read-only', async () => {
  const writable = fakeServer();
  registerProfileTools(writable as never, false);
  assert.deepEqual(writable.tools.map((t) => t.name), ['splalm_get_profile', 'splalm_set_profile']);
  const readOnly = fakeServer();
  registerProfileTools(readOnly as never, true);
  assert.deepEqual(readOnly.tools.map((t) => t.name), ['splalm_get_profile']);
});

test('get_profile says the hosts and the profile; set_profile switches it', async () => {
  const realFetch = globalThis.fetch;
  const seen: { method: string; url: string; body?: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ method: init?.method ?? 'GET', url: String(url), ...(init?.body ? { body: String(init.body) } : {}) });
    const path = new URL(String(url)).pathname;
    if (path === '/api/users/loginFromServiceToken') return new Response(JSON.stringify({ token: 't', user: { hosts: ['local', 'github'], activeHost: 'local' } }), { status: 200 });
    if (path === '/api/users/profile') return new Response(JSON.stringify({ hosts: ['local', 'github'], activeHost: 'github' }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const server = fakeServer();
    registerProfileTools(server as never, false);
    const [get, set] = server.tools as [Tool, Tool];
    assert.deepEqual(JSON.parse((await get.handler({})).content[0]!.text), { hosts: ['local', 'github'], activeHost: 'local' });
    assert.equal(JSON.parse((await set.handler({ host: 'github' })).content[0]!.text).activeHost, 'github');
    assert.deepEqual(seen.at(-1), { method: 'PUT', url: 'http://linea.test/api/users/profile', body: '{"host":"github"}' });
  } finally {
    globalThis.fetch = realFetch;
  }
});
