import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import healthRouter from './routes/health.js';
import { createRequirementsRouter } from './routes/requirements.js';
import type { GenerateInterpretation } from './services/requirements.js';

export function createApp(generate?: GenerateInterpretation) {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '32kb', strict: false }));
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/requirements', createRequirementsRouter(generate));
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: {
      code: status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR',
      message: status === 413 ? 'Request body is too large.' : status === 400 ? 'Request body must be valid JSON.' : 'An internal error occurred.',
    } });
  };
  app.use(handleError);
  return app;
}
