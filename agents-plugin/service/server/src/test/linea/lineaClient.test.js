import http from 'node:http';
import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import User from '../../model/entities/user.js';
import { setup, clear, teardown } from '../setup.js';
import { linea } from '../../linea/LineaClient.js';
import { runAs } from '../../linea/actingUser.js';
import { LineaApiError, LineaUnreachableError, NoActingUserError } from '../../linea/errors.js';

// A LINEA that answers what each test says and remembers what it was asked.
let fake;
let seen;
let respond;

const startFake = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, actAs: req.headers['x-act-as'], body: raw ? JSON.parse(raw) : undefined });
      const { status = 200, body = {} } = respond(req, seen.length) ?? {};
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === null ? '' : JSON.stringify(body));
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

beforeAll(async () => { await setup(); fake = await startFake(); });
afterAll(async () => { await new Promise((resolve) => fake.close(resolve)); await teardown(); });
beforeEach(() => {
  seen = [];
  respond = () => ({ body: { ok: true } });
  process.env.LINEA_API_URL = `http://127.0.0.1:${fake.address().port}/`;
  process.env.AGENTS_SERVICE_KEY = 'k-1';
});
afterEach(clear);

const makeUser = () => new User({ username: 'ana' }).save();

describe('LineaClient', () => {
  test('calls LINEA as the person, with the key of the service', async () => {
    const user = await makeUser();
    respond = () => ({ body: [{ _id: 'l1' }] });

    const lines = await linea.get('/api/lines/enrolled', { userId: String(user._id) });

    expect(lines).toEqual([{ _id: 'l1' }]);
    expect(seen).toEqual([{ method: 'GET', url: '/api/lines/enrolled', authorization: 'Service k-1', actAs: 'ana', body: undefined }]);
  });

  test('acts as the user of the current request or run when none is given', async () => {
    const user = await makeUser();

    await runAs(user._id, () => linea.get('/api/products/enrolled'));

    expect(seen[0]).toMatchObject({ authorization: 'Service k-1', actAs: 'ana' });
  });

  test('refuses to call without somebody to act for', async () => {
    await expect(linea.get('/api/lines/enrolled')).rejects.toBeInstanceOf(NoActingUserError);
    expect(seen).toHaveLength(0);
  });

  test('refuses to call without the key of the service', async () => {
    const user = await makeUser();
    delete process.env.AGENTS_SERVICE_KEY;

    await expect(linea.get('/api/lines/enrolled', { userId: String(user._id) })).rejects.toThrow(/AGENTS_SERVICE_KEY/);
    expect(seen).toHaveLength(0);
  });

  test('sends the body and the query, leaving out what is undefined', async () => {
    const user = await makeUser();

    await linea.post('/api/lines/l1/plan-branch/merge', { branch: 'plan/x' }, { userId: String(user._id) });
    await linea.get('/api/lines/l1/products', { userId: String(user._id), query: { spec: 1, cut: undefined } });

    expect(seen[0]).toMatchObject({ method: 'POST', body: { branch: 'plan/x' } });
    expect(seen[1].url).toBe('/api/lines/l1/products?spec=1');
  });

  test.each([[401], [403], [404], [409], [503]])('a %i from LINEA is a LineaApiError carrying it', async (status) => {
    const user = await makeUser();
    respond = () => ({ status, body: { error: 'error_messages.x' } });

    const error = await linea.get('/api/products/p1', { userId: String(user._id) }).catch((e) => e);

    expect(error).toBeInstanceOf(LineaApiError);
    expect(error.status).toBe(status);
    expect(error.body).toEqual({ error: 'error_messages.x' });
    expect(seen).toHaveLength(1);
  });

  test('an empty answer is null', async () => {
    const user = await makeUser();
    respond = () => ({ status: 200, body: null });

    expect(await linea.put('/api/lines/l1/model', { content: 'x' }, { userId: String(user._id) })).toBeNull();
  });

  test('a LINEA that is down is "unreachable", not a verdict about the data', async () => {
    const user = await makeUser();
    process.env.LINEA_API_URL = 'http://127.0.0.1:9';

    const error = await linea.get('/api/lines/enrolled', { userId: String(user._id) }).catch((e) => e);

    expect(error).toBeInstanceOf(LineaUnreachableError);
  });

  test('says where LINEA is not set', async () => {
    const user = await makeUser();
    delete process.env.LINEA_API_URL;

    await expect(linea.get('/api/lines/enrolled', { userId: String(user._id) })).rejects.toThrow(/LINEA_API_URL/);
  });
});

