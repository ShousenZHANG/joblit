import { STORAGE_KEYS } from "@ext/shared/constants";

/** A queued item pending sync to the server. */
export interface QueuedItem {
  id: string;
  type: "submission" | "field_mapping";
  payload: Record<string, unknown>;
  createdAt: number;
  retries: number;
}

const MAX_RETRIES = 5;
const QUEUE_KEY = "syncQueue";

/** Get all queued items from storage. */
export async function getQueue(): Promise<QueuedItem[]> {
  const result = await chrome.storage.local.get(QUEUE_KEY);
  return result[QUEUE_KEY] ?? [];
}

/** Add an item to the offline sync queue. */
export async function enqueue(
  type: QueuedItem["type"],
  payload: Record<string, unknown>,
): Promise<void> {
  const queue = await getQueue();
  const item: QueuedItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    createdAt: Date.now(),
    retries: 0,
  };
  queue.push(item);
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

/** Remove an item from the queue by id. */
export async function dequeue(id: string): Promise<void> {
  const queue = await getQueue();
  const filtered = queue.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [QUEUE_KEY]: filtered });
}

/** Increment retry count for an item. Removes it if over max retries. */
export async function markRetry(id: string): Promise<boolean> {
  const queue = await getQueue();
  const item = queue.find((i) => i.id === id);
  if (!item) return false;

  item.retries += 1;
  if (item.retries >= MAX_RETRIES) {
    await dequeue(id);
    return false; // Dropped
  }

  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  return true; // Will retry
}

/** Get the count of pending items. */
export async function getQueueSize(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

/** Clear all items from the queue. */
export async function clearQueue(): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: [] });
}
