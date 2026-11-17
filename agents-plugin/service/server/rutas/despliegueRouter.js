import express from 'express';

import { requireAuth } from '../src/rest/common/auth.js';
import { asyncHandler } from '../src/rest/common/asyncHandler.js';
import { linea } from '../src/linea/LineaClient.js';

const despliegueRouter = express.Router();

/** Fleet figures from the generations LINEA runs. */
despliegueRouter.get(
  '/deployment-metrics',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).send(await linea.get('/api/logs/metrics', { userId: req.userId }));
  }),
);

export default despliegueRouter;
