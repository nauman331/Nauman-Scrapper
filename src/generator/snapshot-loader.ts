import { resultRepository } from '../persistence/repositories/result.repository.js';

export interface SnapshotBudget { pages: number; bytes: number }
const MAX_PAGES = 500;
const MAX_BYTES = 32 * 1024 * 1024;

/** Bound retained JSON across batches and combined jobs before DOM parsing. */
export async function loadBoundedSnapshot(
  jobId: string,
  urls?: string[],
  budget: SnapshotBudget = { pages: 0, bytes: 0 }
) {
  type Batch = Awaited<ReturnType<typeof resultRepository.getResultsByJobId>>;
  const items: Batch['items'] = [];
  let total = 0;
  let offset = 0;
  do {
    if (budget.pages >= MAX_PAGES) throw new Error('Snapshot exceeds 500 pages per project. Select fewer pages.');
    const batch = await resultRepository.getResultsByJobId(jobId, {
      limit: Math.min(25, MAX_PAGES - budget.pages), offset, urls,
    });
    total = batch.total;
    if (!batch.items.length) break;
    for (const item of batch.items) {
      const bytes = Buffer.byteLength(JSON.stringify(item.rawData ?? {})) + Buffer.byteLength(JSON.stringify(item.normalizedData ?? {}));
      if (budget.pages + 1 > MAX_PAGES || budget.bytes + bytes > MAX_BYTES)
        throw new Error('Snapshot exceeds the safe project budget (500 pages / 32 MiB). Select fewer pages or export separate projects.');
      budget.pages++;
      budget.bytes += bytes;
      items.push(item);
    }
    offset += batch.items.length;
  } while (offset < total);
  return { items, total };
}
