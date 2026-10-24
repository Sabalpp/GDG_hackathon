import { Router } from 'express';
import { interpretRequestSchema } from '../schemas/requirements.js';
import { InterpretationError, interpretRequirements, type GenerateInterpretation } from '../services/requirements.js';

export function createRequirementsRouter(generate?: GenerateInterpretation) {
  const router = Router();
  router.post('/interpret', async (req, res, next) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
      return;
    }
    const parsed = interpretRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Expected an object with text containing between 1 and 8000 characters.' } });
      return;
    }
    try {
      res.json(await interpretRequirements(parsed.data, generate));
    } catch (error) {
      if (error instanceof InterpretationError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      next(error);
    }
  });
  return router;
}
