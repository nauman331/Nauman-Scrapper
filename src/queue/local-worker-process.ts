import { connectDatabase, disconnectDatabase } from '../persistence/prisma.js';
import { ScrapingWorker } from './worker.js';
import type { WorkerCommand, WorkerReply } from './local-worker-pool.js';

const worker = new ScrapingWorker();
const cancelled = new Set<string>();
let active: Promise<void> | undefined;
let stopping = false;

const reply = (message: WorkerReply) => {
  if (process.connected) process.send?.(message);
};
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  // Cancellation callbacks stop the active crawler before the database closes.
  await active;
  await disconnectDatabase();
  process.exit(0);
}

process.on('message', (message: WorkerCommand) => {
  if (message.type === 'cancel') cancelled.add(message.jobId);
  else if (message.type === 'shutdown') void shutdown();
  else if (message.type === 'run' && !stopping) {
    if (active) {
      reply({ type: 'done', jobId: message.payload.jobId, error: 'Worker already has an active job' });
      return;
    }
    const { payload } = message;
    active = (async () => {
      try {
        await worker.processJob(payload, () => stopping || cancelled.has(payload.jobId));
        reply({ type: 'done', jobId: payload.jobId });
      } catch (error) {
        reply({ type: 'done', jobId: payload.jobId, error: error instanceof Error ? error.message : String(error) });
      } finally {
        cancelled.delete(payload.jobId);
        active = undefined;
      }
    })();
  }
});
process.on('disconnect', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });

connectDatabase().then(() => reply({ type: 'ready', pid: process.pid })).catch(error => {
  console.error('Local worker database startup failed:', error);
  process.exit(1);
});
