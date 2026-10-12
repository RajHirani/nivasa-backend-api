import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFound } from './middleware/error.js';
import { env } from './config/env.js';

export const app = express();

app.use(helmet());
// Cookies need an explicit allowlist (a wildcard origin cannot be combined with credentials).
app.use(cors({ origin: env.cors.origins, credentials: true }));
app.use(express.json());

app.use('/api/v1', apiRouter);

app.use(notFound);
app.use(errorHandler);
