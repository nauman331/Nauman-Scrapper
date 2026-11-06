export interface QueueJobPayload {
  jobId: string;
  targetUrl: string;
  domain: string;
  priority: number;
  retryLimit: number;
  attemptNumber?: number;
}

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

export interface IJobQueue {
  addJob(jobId: string, payload: QueueJobPayload, priority?: number): Promise<void>;
  cancelJob(jobId: string): Promise<boolean>;
  isJobCancelled(jobId: string): boolean;
  getQueueMetrics(): Promise<QueueMetrics>;
  startProcessing(handler: (payload: QueueJobPayload) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
