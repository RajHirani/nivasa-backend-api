import cron from 'node-cron';
import { deleteStaleUploads } from '../modules/uploads/uploads.service.js';

// Starts the scheduled jobs and returns a function that stops them (called on shutdown).
export const startJobs = (): (() => void) => {
  // Unattached uploads older than 24 h are removed at the top of every hour.
  const staleUploads = cron.schedule('0 * * * *', async () => {
    try {
      await deleteStaleUploads();
    } catch (e) {
      console.error('Stale upload cleanup failed', e);
    }
  });
  return () => {
    staleUploads.stop();
  };
};
