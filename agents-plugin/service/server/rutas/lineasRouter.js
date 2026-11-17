import express from 'express';

import { requireAuth } from '../src/rest/common/auth.js';
import { asyncHandler } from '../src/rest/common/asyncHandler.js';
import { linea } from '../src/linea/LineaClient.js';

const lineasRouter = express.Router();

/** The lines the person is a member of, as LINEA says. */
lineasRouter.get(
  '/lines',
  requireAuth,
  asyncHandler(async (req, res) => {
    const lines = await linea.get('/api/lines/enrolled', { userId: req.userId });
    res.status(200).send(lines.map((l) => ({ id: String(l._id), name: l.name, version: l.version })));
  }),
);

export default lineasRouter;
