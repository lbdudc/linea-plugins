import express from 'express';

import { requireAuth } from '../src/rest/common/auth.js';
import { asyncHandler } from '../src/rest/common/asyncHandler.js';
import { linea } from '../src/linea/LineaClient.js';

const productosRouter = express.Router();

/** The products the person is a member of, as LINEA lists them (name, version, line, last sync, repository). */
productosRouter.get(
  '/products/enrolled',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).send(await linea.get('/api/products/enrolled', { userId: req.userId }));
  }),
);

export default productosRouter;
