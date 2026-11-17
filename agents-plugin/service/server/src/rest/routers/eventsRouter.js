import crypto from 'node:crypto';
import express from 'express';
import domainEvents, { DOMAIN_EVENTS } from '../../model/events/domainEvents.js';

/**
 * What happens in LINEA that agents reacts to (a product was generated, with or without conflicts). LINEA posts it, signed:
 * `X-Linea-Signature: sha256=<hmac of the raw body, keyed by EVENT_WEBHOOK_SECRET>`. Configure LINEA's EVENT_WEBHOOK_URLS with this
 * route's URL and the same EVENT_WEBHOOK_SECRET.
 *
 * The body has to be parsed with `req.rawBody` kept (see index.js): the signature is over the bytes LINEA sent.
 */
export const signatureMatches = (rawBody, header, secret) => {
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' || typeof secret !== 'string' || secret === '') return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const provided = Buffer.from(header);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
};

const eventsRouter = express.Router();

eventsRouter.post('/', (req, res) => {
  if (!signatureMatches(req.rawBody, req.get('X-Linea-Signature'), process.env.EVENT_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'errors.unauthorized' });
  }

  const { event, payload } = req.body ?? {};
  const knownEvents = Object.values(DOMAIN_EVENTS);
  if (typeof event !== 'string' || !knownEvents.includes(event)) {
    return res.status(400).json({ error: 'errors.invalid_argument', detail: `unknown event "${event}"`, knownEvents });
  }
  if (payload === null || typeof payload !== 'object') {
    return res.status(400).json({ error: 'errors.invalid_argument', detail: 'payload must be an object' });
  }

  const delivered = domainEvents.emit(event, payload);
  return res.status(202).json({ status: 'accepted', delivered });
});

export default eventsRouter;
