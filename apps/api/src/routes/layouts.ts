import { Router } from 'express';
import { validateRequestSchema } from '../schemas/layout.js';
import { validateLayout } from '../services/layout.js';

const router = Router();

router.post('/validate', (req, res) => {
  if (!req.is('application/json')) {
    res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
    return;
  }
  const parsed = validateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide calibrated layout geometry and confirmed goals in millimeters.' } });
    return;
  }
  res.json(validateLayout(parsed.data.layout, parsed.data.goals));
});

export default router;
