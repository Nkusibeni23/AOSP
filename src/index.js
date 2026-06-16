import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { startMqtt } from './mqtt/client.js';
import { authRouter } from './routes/auth.js';
import { enrollRouter } from './routes/enroll.js';
import { devicesRouter } from './routes/devices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiSpec = YAML.parse(fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'));

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: false, // swagger-ui needs inline styles
  }),
);
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(pinoHttp({ logger }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/openapi.json', (_req, res) => res.json(openapiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'RMSoft OS API',
  swaggerOptions: { persistAuthorization: true },
}));

app.use('/api/auth', authRouter);
app.use('/api', enrollRouter);
app.use('/api/devices', devicesRouter);

app.use((err, _req, res, _next) => {
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'internal' });
});

startMqtt();

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env, docs: `http://localhost:${config.port}/docs` },
    'rmsoft-server listening',
  );
});

function shutdown(sig) {
  logger.info({ sig }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
