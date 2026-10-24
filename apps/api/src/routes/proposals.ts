import { Router } from 'express';
import { generateProposalRequestSchema } from '../schemas/proposals.js';
import { GeometryError } from '../services/geometry.js';
import { CostCatalogError } from '../services/costs.js';
import { generateProposals, type ProposalGenerationOptions } from '../services/proposals.js';

export function createProposalsRouter(options: ProposalGenerationOptions = {}) {
  const router = Router();
  router.post('/generate', async (req, res, next) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
      return;
    }
    const parsed = generateProposalRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_PROPOSAL_REQUEST', message: 'Expected a valid mm layout, confirmed goals, and optional USD budget.' } });
      return;
    }
    try {
      res.json(await generateProposals(parsed.data, options));
    } catch (error) {
      if (error instanceof GeometryError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof CostCatalogError) {
        res.status(503).json({ error: { code: 'COST_CATALOG_UNAVAILABLE', message: error.message } });
        return;
      }
      next(error);
    }
  });
  return router;
}
