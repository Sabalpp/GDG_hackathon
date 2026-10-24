import { Router } from 'express';
import { CostCatalogError, getCostCatalog } from '../services/costs.js';

const catalogRouter = Router();
catalogRouter.get('/costs', async (_req, res, next) => {
  try {
    res.json(await getCostCatalog());
  } catch (error) {
    if (error instanceof CostCatalogError) {
      res.status(503).json({ error: { code: 'COST_CATALOG_UNAVAILABLE', message: error.message } });
      return;
    }
    next(error);
  }
});
export default catalogRouter;
