import express from 'express';
import request from 'supertest';
import { test, expect, describe, beforeAll, afterEach, afterAll } from 'vitest';
import { setup, clear, teardown } from '../setup.js';
import { createUser, createLine, createProduct, noFeatureSpec, setupFakeLinea, resetFakeLinea, teardownFakeLinea } from '../support/world.js';
import lineaRouter from '../../../rutas/lineaRouter.js';
import { onError } from '../../rest/common/onError.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

const app = express();
app.use('/api/agents', lineaRouter);
app.use(onError);

// what LINEA's server passes on for a person who is signed in to it
const asUser = async () => {
  const user = await createUser('ui');
  return { user, auth: { 'X-Agents-Key': 'test-service-key', 'X-Act-As': user.username, 'X-Act-As-Admin': '1' } };
};

describe('what the interface asks of LINEA, through agents-server', () => {
  test('the feature model comes as a base64 UVL file, the shape the interface reads', async () => {
    const { user, auth } = await asUser();
    const line = createLine({ user, name: 'UiLine', uvl: 'features\n    Root\n        optional\n            Ñandú\n' });

    const res = await request(app).get(`/api/agents/linea/lines/${line._id}/feature-model`).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.featureModelType).toBe('UVL');
    expect(Buffer.from(res.body.content, 'base64').toString('utf8')).toContain('Ñandú');
  });

  test('a line, a product\'s health and its conflicts are LINEA\'s answers', async () => {
    const { user, auth } = await asUser();
    const line = createLine({ user, name: 'UiLine2' });
    const product = createProduct({ line, spec: noFeatureSpec('UiProduct') });

    expect((await request(app).get(`/api/agents/linea/lines/${line._id}`).set(auth)).body.name).toBe('UiLine2');
    expect((await request(app).get(`/api/agents/linea/products/${product._id}/health`).set(auth)).body.valid).toBe(true);
    expect((await request(app).get(`/api/agents/linea/products/${product._id}/conflicts`).set(auth)).body).toEqual({ conflictingMRs: 0 });
  });

  test('LINEA\'s "not found" reaches the interface as a 404', async () => {
    const { auth } = await asUser();

    const res = await request(app).get('/api/agents/linea/lines/aaaaaaaaaaaaaaaaaaaaaaaa').set(auth);

    expect(res.status).toBe(404);
  });

  test('an id that is not an id is refused before LINEA is asked', async () => {
    const { auth } = await asUser();

    const res = await request(app).get('/api/agents/linea/lines/..%2F..%2Fusers').set(auth);

    expect(res.status).toBe(400);
  });

  test('needs an agents session', async () => {
    const res = await request(app).get('/api/agents/linea/lines/aaaaaaaaaaaaaaaaaaaaaaaa');

    expect(res.status).toBe(401);
  });
});
