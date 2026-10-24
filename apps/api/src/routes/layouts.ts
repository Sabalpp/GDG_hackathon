import { Router } from 'express';
import { validateLayoutRequestSchema } from '../schemas/layouts.js';
import { GeometryError } from '../services/geometry.js';
import { validateLayout, type LayoutValidationOptions } from '../services/layouts.js';

export function createLayoutsRouter(options: LayoutValidationOptions = {}) {
  const router = Router();
  router.post('/validate', async (req, res, next) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
      return;
    }
    const parsed = validateLayoutRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_GEOMETRY_REQUEST', message: 'Expected a valid millimeter layout and goals with valid references and at least one confirmed goal.' } });
      return;
    }
    try {
      res.json(await validateLayout(parsed.data, options));
    } catch (error) {
      if (error instanceof GeometryError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      next(error);
    }
  });
  return router;
}
