import { env } from './config/env.js';
import { app } from './app.js';
import { prisma } from './lib/prisma.js';
import { deleteStaleUploads } from './modules/uploads/uploads.service.js';

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}/api/v1 (${env.nodeEnv})`);
});

// Unattached uploads older than 24 h are removed hourly.
const cleanup = setInterval(() => {
  deleteStaleUploads().catch((e) => console.error('Stale upload cleanup failed', e));
}, 60 * 60 * 1000);
cleanup.unref();

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
