import { Router } from 'express';
import { generateRequestSchema } from '../schemas/layout.js';
import { generateProposal } from '../services/layout.js';

const router = Router();

router.post('/generate', (req, res) => {
  if (!req.is('application/json')) {
    res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
    return;
  }
  const parsed = generateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide calibrated layout geometry and confirmed goals in millimeters.' } });
    return;
  }
  res.json(generateProposal(parsed.data.layout, parsed.data.goals, parsed.data.budgetUsd));
});

export default router;
