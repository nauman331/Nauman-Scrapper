interface QueueRequest {
  url: string;
  userData: { depth: number };
}
interface QueueAdmission {
  addRequest(request: QueueRequest): Promise<{ wasAlreadyPresent: boolean }>;
}

/** Serializes admissions, including deduplication, so parallel handlers cannot overshoot. */
export function createBoundedEnqueue(queue: QueueAdmission, maxPages: number) {
  let admitted = 0;
  let pending: Promise<unknown> = Promise.resolve();
  return (url: string, depth: number): Promise<boolean> => {
    const result = pending.then(async () => {
      if (admitted >= maxPages) return false;
      const info = await queue.addRequest({ url, userData: { depth } });
      if (!info.wasAlreadyPresent) admitted++;
      return true;
    });
    pending = result.catch(() => {});
    return result;
  };
}
