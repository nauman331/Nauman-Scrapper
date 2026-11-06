import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { QueueJobPayload } from './queue.interface.js';
import { logger } from '../monitoring/logger.js';

export type WorkerCommand =
  | { type: 'run'; payload: QueueJobPayload }
  | { type: 'cancel'; jobId: string }
  | { type: 'shutdown' };
export type WorkerReply =
  | { type: 'ready'; pid: number }
  | { type: 'done'; jobId: string; error?: string };
interface Task {
  payload: QueueJobPayload;
  isCancelled: () => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}
interface Slot { child: ChildProcess; ready: boolean; task?: Task; cancelTimer?: NodeJS.Timeout }

/** One parent-owned queue and one active job per independent Node.js child. */
export class LocalWorkerPool {
  private slots: Slot[] = [];
  private pending: Task[] = [];
  private closing = false;
  private readonly runId = randomUUID();

  constructor(private readonly size: number, private readonly entry = new URL('./local-worker-process.js', import.meta.url)) {}

  async start(): Promise<void> {
    try { await Promise.all(Array.from({ length: this.size }, () => this.spawn())); }
    catch (error) { await this.close(); throw error; }
  }

  private spawn(): Promise<void> {
    const source = import.meta.url.endsWith('.ts');
    const entry = source && this.entry.pathname.endsWith('/local-worker-process.js')
      ? new URL('./local-worker-process.ts', import.meta.url) : this.entry;
    const child = fork(fileURLToPath(entry), [], {
      execArgv: source ? ['--import', 'tsx'] : [],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        // Crawlee's default stats/queues must not collide between processes or restarts.
        CRAWLEE_STORAGE_DIR: path.resolve(process.cwd(), 'storage', 'local-workers', this.runId, randomUUID()),
      },
    });
    const slot: Slot = { child, ready: false };
    this.slots.push(slot);
    return new Promise<void>((resolve, reject) => {
      let started = false;
      const timeout = setTimeout(() => {
        reject(new Error('Local worker startup timed out'));
        child.kill();
      }, 30000);
      const fail = (error: Error) => {
        clearTimeout(timeout);
        if (!started) reject(error);
        if (slot.cancelTimer) clearInterval(slot.cancelTimer);
        slot.task?.reject(error);
        slot.task = undefined;
        slot.ready = false;
      };
      child.on('message', (message: WorkerReply) => {
        if (message.type === 'ready') {
          started = true;
          clearTimeout(timeout);
          slot.ready = true;
          logger.info({ pid: message.pid, workers: this.size }, 'Local scraping process ready');
          resolve();
          this.dispatch();
        } else if (message.type === 'done' && slot.task?.payload.jobId === message.jobId) {
          const task = slot.task;
          clearInterval(slot.cancelTimer);
          slot.task = undefined;
          if (message.error) task.reject(new Error(message.error));
          else task.resolve();
          this.dispatch();
        }
      });
      child.on('error', fail);
      child.on('exit', (code, signal) => {
        fail(new Error(`Local worker exited (code ${code}, signal ${signal})`));
        this.slots = this.slots.filter(candidate => candidate !== slot);
        if (!this.closing && started) {
          // Replace a crashed child; never silently run jobs in the API process.
          void this.spawn().catch(error => {
            logger.error({ error }, 'Unable to replace local worker');
            for (const task of this.pending.splice(0)) task.reject(error);
          });
        }
      });
    });
  }

  execute(payload: QueueJobPayload, isCancelled: () => boolean): Promise<void> {
    if (this.closing) return Promise.reject(new Error('Local worker pool is shutting down'));
    return new Promise((resolve, reject) => {
      this.pending.push({ payload, isCancelled, resolve, reject });
      this.dispatch();
    });
  }

  private dispatch(): void {
    if (this.closing) return;
    for (const slot of this.slots) {
      if (!slot.ready || slot.task || !slot.child.connected) continue;
      let task = this.pending.shift();
      while (task?.isCancelled()) { task.resolve(); task = this.pending.shift(); }
      if (!task) break;
      slot.task = task;
      let cancelled = false;
      slot.cancelTimer = setInterval(() => {
        if (!cancelled && task!.isCancelled()) {
          cancelled = true;
          slot.child.send({ type: 'cancel', jobId: task!.payload.jobId } satisfies WorkerCommand);
        }
      }, 100);
      slot.child.send({ type: 'run', payload: task.payload } satisfies WorkerCommand, error => {
        if (error) slot.child.kill();
      });
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const task of this.pending.splice(0)) task.reject(new Error('Local worker pool stopped'));
    await Promise.all(this.slots.map(slot => new Promise<void>(resolve => {
      clearInterval(slot.cancelTimer);
      if (slot.child.exitCode !== null || slot.child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => slot.child.kill(), 10000);
      slot.child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (slot.child.connected) slot.child.send({ type: 'shutdown' } satisfies WorkerCommand);
      else slot.child.kill();
    })));
  }
}
