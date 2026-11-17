import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { vi, test, expect, describe, beforeEach } from 'vitest';
import domainEvents, { DOMAIN_EVENTS } from '../../model/events/domainEvents.js';
import eventsRouter from '../../rest/routers/eventsRouter.js';

const SECRET = 'event-secret';
const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use('/api/events', eventsRouter);

const signed = (body, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
const post = (payload, { signature, secret } = {}) => {
  const body = JSON.stringify(payload);
  return request(app).post('/api/events').set('Content-Type', 'application/json').set('X-Linea-Signature', signature ?? signed(body, secret)).send(body);
};

beforeEach(() => {
  process.env.EVENT_WEBHOOK_SECRET = SECRET;
  domainEvents.removeAllListeners();
});

describe('POST /api/events', () => {
  test('a correctly signed PRODUCT_GENERATED is emitted on the in-process bus, with its payload', async () => {
    const listener = vi.fn();
    domainEvents.on(DOMAIN_EVENTS.PRODUCT_GENERATED, listener);
    const payload = { productId: 'p1', lineId: 'l1', conflicts: true, stage: 'update', actor: { username: 'ana' } };

    const res = await post({ event: DOMAIN_EVENTS.PRODUCT_GENERATED, payload });

    expect(res.status).toBe(202);
    expect(listener).toHaveBeenCalledWith(payload);
  });

  test('a signature made with another secret is a 401 and emits nothing', async () => {
    const listener = vi.fn();
    domainEvents.on(DOMAIN_EVENTS.PRODUCT_GENERATED, listener);

    const res = await post({ event: DOMAIN_EVENTS.PRODUCT_GENERATED, payload: {} }, { secret: 'wrong' });

    expect(res.status).toBe(401);
    expect(listener).not.toHaveBeenCalled();
  });

  test('a signature over a different body is a 401', async () => {
    const other = signed(JSON.stringify({ event: DOMAIN_EVENTS.PRODUCT_GENERATED, payload: { productId: 'other' } }));

    const res = await post({ event: DOMAIN_EVENTS.PRODUCT_GENERATED, payload: { productId: 'p1' } }, { signature: other });

    expect(res.status).toBe(401);
  });

  test('without a signature, or with no secret configured, it is a 401 (never open)', async () => {
    const body = JSON.stringify({ event: DOMAIN_EVENTS.PRODUCT_GENERATED, payload: {} });
    const unsigned = await request(app).post('/api/events').set('Content-Type', 'application/json').send(body);
    delete process.env.EVENT_WEBHOOK_SECRET;
    const noSecret = await post({ event: DOMAIN_EVENTS.PRODUCT_GENERATED, payload: {} }, { signature: signed(body, '') });

    expect(unsigned.status).toBe(401);
    expect(noSecret.status).toBe(401);
  });

  test.each([
    ['an unknown event', { event: 'nope', payload: {} }],
    ['no payload', { event: 'product:generated' }],
  ])('%s is a 400', async (_name, body) => {
    expect((await post(body)).status).toBe(400);
  });
});
