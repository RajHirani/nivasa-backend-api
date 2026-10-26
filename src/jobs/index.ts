import cron from 'node-cron';
import { expireNotices } from '../modules/notices/notices.service.js';
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
  // Published notices past their expiry date become Expired (the app and the lists also check the date, so nothing shows late).
  const noticeExpiry = cron.schedule('5 * * * *', async () => {
    try {
      await expireNotices();
    } catch (e) {
      console.error('Notice expiry failed', e);
    }
  });
  return () => {
    staleUploads.stop();
    noticeExpiry.stop();
  };
};
