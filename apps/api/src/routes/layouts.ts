import { Router } from 'express';
import { validateRequestSchema } from '../schemas/layout.js';
import { callGeometry, GeometryUnavailableError } from '../services/geometryClient.js';

const router = Router();

router.post('/validate', async (req, res) => {
  if (!req.is('application/json')) {
    res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
    return;
  }
  const parsed = validateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide calibrated layout geometry and confirmed goals in millimeters.' } });
    return;
  }
  try {
    res.json(await callGeometry('/api/v1/layouts/validate', parsed.data));
  } catch (error) {
    const status = error instanceof GeometryUnavailableError ? 503 : (error as Error & { status?: number }).status ?? 502;
    res.status(status).json({ error: { code: status === 503 ? 'GEOMETRY_UNAVAILABLE' : 'GEOMETRY_REQUEST_FAILED', message: error instanceof Error ? error.message : 'Geometry validation failed.' } });
  }
});

export default router;
