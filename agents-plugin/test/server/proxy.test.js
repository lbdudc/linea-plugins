import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import plugin from '../../server/index.js';
import manifest from '../../plugin.json' with { type: 'json' };
import { resolveSettings } from '../../../../linea/apps/server/src/config/settings.js';
import { asyncHandler } from '../../../../linea/apps/server/src/rest/common/asyncHandler.js';

// A fake agents service that remembers what it was asked, and the plugin registered as the host does it, with a person signed in.
let service;
let asked;
let answer;
const emitted = [];

const startService = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      asked.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : undefined });
      const { status = 200, body = { ok: true }, type = 'application/json' } = answer(req) ?? {};
      res.writeHead(status, { 'Content-Type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const build = ({ person = { username: 'ana', admin: false, avatarUrl: 'http://a/x.png' }, service: asService = null } = {}) => {
  const router = express.Router();
  plugin.register({
    id: 'agents-plugin',
    router: () => router,
    // the settings as the host resolves them from the manifest (the env is where they come from in this test)
    settings: () => resolveSettings(manifest.settings, { env: process.env }).values,
    services: {
      requireAuth: (req, res, next) => { req.userId = 'u1'; if (asService) req.serviceId = asService; next(); },
      asyncHandler,
      userRepository: { findById: async () => person },
    },
  });
  const app = express();
  app.use(express.json());
  app.set('io', { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });
  app.use('/api/plugins/agents-plugin', router);
  return app;
};

beforeAll(async () => { service = await startService(); });
afterAll(() => new Promise((resolve) => service.close(resolve)));
beforeEach(() => {
  asked = [];
  emitted.length = 0;
  answer = () => ({ body: { ok: true } });
  process.env.AGENTS_URL = `http://127.0.0.1:${service.address().port}/`;
  process.env.AGENTS_SERVICE_KEY = 'k-1';
});

describe('the agents API, through LINEA', () => {
  test('a call is passed on with the key and who the person is; the answer comes back as it is', async () => {
    answer = () => ({ status: 201, body: { run: 'r1' } });

    const res = await request(build()).post('/api/plugins/agents-plugin/api/agents/runs?x=1').send({ agent: 'sync' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ run: 'r1' });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ method: 'POST', url: '/api/agents/runs?x=1', body: { agent: 'sync' } });
    expect(asked[0].headers).toMatchObject({ 'x-agents-key': 'k-1', 'x-act-as': 'ana', 'x-act-as-admin': '0', 'x-act-as-avatar': 'http://a/x.png' });
  });

  test('an administrator of LINEA is one for the agents', async () => {
    await request(build({ person: { username: 'root', admin: true } })).get('/api/plugins/agents-plugin/api/agents/health');
    expect(asked[0].headers).toMatchObject({ 'x-act-as': 'root', 'x-act-as-admin': '1' });
  });

  test('what the service refuses reaches the page with its status', async () => {
    answer = () => ({ status: 404, body: { error: 'error_messages.not_found' } });

    const res = await request(build()).get('/api/plugins/agents-plugin/api/agents/runs/x');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'error_messages.not_found' });
  });

  test('a service that is not there is a 503 the page can show, not a hang', async () => {
    process.env.AGENTS_URL = 'http://127.0.0.1:9';

    const res = await request(build()).get('/api/plugins/agents-plugin/api/agents/runs');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('error_messages.agents_unavailable');
  });

  test('without the key nothing is passed on', async () => {
    delete process.env.AGENTS_SERVICE_KEY;

    const res = await request(build()).get('/api/plugins/agents-plugin/api/agents/runs');

    expect(res.status).toBe(503);
    expect(asked).toHaveLength(0);
  });

  test('a person whose account is gone, with a session still open, is nobody to act as', async () => {
    const res = await request(build({ person: null })).get('/api/plugins/agents-plugin/api/agents/runs');
    expect(res.status).toBe(403);
    expect(asked).toHaveLength(0);
  });

  test('the path cannot leave /api of the service', async () => {
    for (const bad of ['/api/plugins/agents-plugin/api/../admin', '/api/plugins/agents-plugin/api/%2e%2e/admin', '/api/plugins/agents-plugin/api/agents/..%2f..%2fx', '/api/plugins/agents-plugin/other']) {
      const res = await request(build()).get(bad);
      expect(res.status, bad).toBeGreaterThanOrEqual(400);
    }
    expect(asked).toHaveLength(0);
  });

  test('a body that is not JSON (an upload) is passed on as it came', async () => {
    const res = await request(build()).post('/api/plugins/agents-plugin/api/agents/upload').set('Content-Type', 'text/plain').send('hello, not json');
    expect(res.status).toBe(200);
    expect(asked[0].headers['content-type']).toBe('text/plain');
  });

  test('a service cannot use the pages\' door', async () => {
    const res = await request(build({ service: 'agents-plugin' })).get('/api/plugins/agents-plugin/api/agents/runs');
    expect(res.status).toBe(403);
    expect(asked).toHaveLength(0);
  });
});

describe('what the agents tell a person', () => {
  test('goes out on the socket of that person', async () => {
    const res = await request(build({ service: 'agents-plugin' })).post('/api/plugins/agents-plugin/relay').send({ event: 'agent-run', payload: { run: { _id: 'r1' } } });

    expect(res.status).toBe(204);
    expect(emitted).toEqual([{ room: 'u1', event: 'agents:agent-run', payload: { run: { _id: 'r1' } } }]);
  });

  test('only the service of this plugin may say it: the key of another service is refused', async () => {
    const res = await request(build({ service: 'other-plugin' })).post('/api/plugins/agents-plugin/relay').send({ event: 'agent-run' });
    expect(res.status).toBe(403);
    expect(emitted).toHaveLength(0);
  });

  test('only a service may say it, and it has to name the event', async () => {
    expect((await request(build()).post('/api/plugins/agents-plugin/relay').send({ event: 'agent-run' })).status).toBe(403);
    expect((await request(build({ service: 'agents-plugin' })).post('/api/plugins/agents-plugin/relay').send({})).status).toBe(400);
    expect(emitted).toHaveLength(0);
  });
});
