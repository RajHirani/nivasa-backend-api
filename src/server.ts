import { env } from './config/env.js';
import { app } from './app.js';
import { prisma } from './lib/prisma.js';
import { startJobs } from './jobs/index.js';

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}/api/v1 (${env.nodeEnv})`);
});

const stopJobs = startJobs();

const shutdown = async () => {
  stopJobs();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
