import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import healthRouter from './routes/health.js';
import { createRequirementsRouter } from './routes/requirements.js';
import layoutsRouter from './routes/layouts.js';
import proposalsRouter from './routes/proposals.js';
import type { GenerateInterpretation } from './services/requirements.js';

export function createApp(generate?: GenerateInterpretation) {
  const app = express();
  const configuredOrigins = new Set((process.env.FRONTEND_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
  const localViteOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || localViteOrigin.test(origin) || configuredOrigins.has(origin)),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  }));
  app.use(express.json({ limit: '32kb', strict: false }));
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/requirements', createRequirementsRouter(generate));
  app.use('/api/v1/layouts', layoutsRouter);
  app.use('/api/v1/proposals', proposalsRouter);
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
