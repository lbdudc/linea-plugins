import express from 'express';
import { Container } from 'typedi';

import { requireAuth } from '../src/rest/common/auth.js';
import { asyncHandler } from '../src/rest/common/asyncHandler.js';
import { linea } from '../src/linea/LineaClient.js';
import LineService from '../src/model/services/LineService.js';

/**
 * What the interface shows of LINEA itself (a line, its feature model, a product's health and conflicts), asked of LINEA as the
 * person. The interface lives on agents' own address and does not talk to LINEA directly: LINEA does not know it, and the person's
 * agents session is not a LINEA one.
 */
const lineaRouter = express.Router();

const ID = /^[0-9a-f]{24}$/i;
const withId = (handler) => asyncHandler(async (req, res) => {
  if (!ID.test(req.params.id)) { res.status(400).send({ error: 'errors.bad_request' }); return; }
  await handler(req, res);
});

lineaRouter.get('/linea/lines/:id', requireAuth, withId(async (req, res) => {
  res.status(200).send(await linea.get(`/api/lines/${req.params.id}`, { userId: req.userId }));
}));

/** The feature model as a file: UVL, base64 (the shape the interface has always read it in). */
lineaRouter.get('/linea/lines/:id/feature-model', requireAuth, withId(async (req, res) => {
  const model = await Container.get(LineService).getFeatureModel({ id: req.params.id, userId: req.userId });
  res.status(200).send({ featureModelType: model.featureModelType, content: Buffer.from(model.content, 'utf8').toString('base64') });
}));

lineaRouter.get('/linea/products/:id/health', requireAuth, withId(async (req, res) => {
  res.status(200).send(await linea.get(`/api/products/${req.params.id}/health`, { userId: req.userId }));
}));

lineaRouter.get('/linea/products/:id/conflicts', requireAuth, withId(async (req, res) => {
  res.status(200).send(await linea.get(`/api/products/${req.params.id}/conflicts`, { userId: req.userId }));
}));

export default lineaRouter;
