import { getQueue, dequeue, markRetry } from "./syncQueue";
import { postSubmission, putFieldMapping } from "./api";

let isSyncing = false;

/** Process all queued items. Called when connectivity is restored. */
export async function processQueue(): Promise<{ synced: number; failed: number }> {
  if (isSyncing) return { synced: 0, failed: 0 };
  isSyncing = true;

  let synced = 0;
  let failed = 0;

  try {
    const queue = await getQueue();

    for (const item of queue) {
      try {
        if (item.type === "submission") {
          await postSubmission(item.payload);
        } else if (item.type === "field_mapping") {
          await putFieldMapping(item.payload);
        }
        await dequeue(item.id);
        synced++;
      } catch {
        const willRetry = await markRetry(item.id);
        if (!willRetry) failed++;
      }
    }
  } finally {
    isSyncing = false;
  }

  return { synced, failed };
}

/** Check if we're currently online. */
export function isOnline(): boolean {
  return navigator.onLine;
}
