import { Router } from 'express';
import { generateRequestSchema } from '../schemas/layout.js';
import { callGeometry, GeometryUnavailableError } from '../services/geometryClient.js';
import { costLinesFor } from './catalog.js';

const router = Router();

router.post('/generate', async (req, res) => {
  if (!req.is('application/json')) {
    res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
    return;
  }
  const parsed = generateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide calibrated layout geometry and confirmed goals in millimeters.' } });
    return;
  }
  try {
    const { layout, goals, budgetUsd } = parsed.data;
    const response = await callGeometry<{ proposals?: unknown[] }>('/api/v1/proposals/generate', {
      layout, goals, ...(budgetUsd === undefined ? {} : { budget: { currency: 'USD', max: budgetUsd } }),
    });
    const proposal = response.proposals?.[0] as ({ modifications?: Array<{ id: string; type: string }>; costs?: unknown[] } & Record<string, unknown>) | undefined;
    if (!proposal) {
      res.status(502).json({ error: { code: 'INVALID_GEOMETRY_RESPONSE', message: 'The geometry service returned no proposal.' } });
      return;
    }
    proposal.costs = await costLinesFor(proposal.modifications ?? []);
    res.json(proposal);
  } catch (error) {
    const status = error instanceof GeometryUnavailableError ? 503 : (error as Error & { status?: number }).status ?? 502;
    res.status(status).json({ error: { code: status === 503 ? 'GEOMETRY_UNAVAILABLE' : 'GEOMETRY_REQUEST_FAILED', message: error instanceof Error ? error.message : 'Proposal generation failed.' } });
  }
});

export default router;
