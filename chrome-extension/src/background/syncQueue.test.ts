import { describe, it, expect, beforeEach } from "vitest";
import { enqueue, dequeue, getQueue, markRetry, getQueueSize, clearQueue } from "./syncQueue";

describe("syncQueue", () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it("starts with empty queue", async () => {
    const queue = await getQueue();
    expect(queue).toEqual([]);
  });

  it("enqueues an item", async () => {
    await enqueue("submission", { pageUrl: "https://example.com" });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe("submission");
    expect(queue[0].payload).toEqual({ pageUrl: "https://example.com" });
    expect(queue[0].retries).toBe(0);
  });

  it("enqueues multiple items", async () => {
    await enqueue("submission", { a: 1 });
    await enqueue("field_mapping", { b: 2 });
    expect(await getQueueSize()).toBe(2);
  });

  it("dequeues an item by id", async () => {
    await enqueue("submission", { a: 1 });
    const queue = await getQueue();
    await dequeue(queue[0].id);
    expect(await getQueueSize()).toBe(0);
  });

  it("increments retry count", async () => {
    await enqueue("submission", { a: 1 });
    const queue = await getQueue();
    const willRetry = await markRetry(queue[0].id);
    expect(willRetry).toBe(true);
    const updated = await getQueue();
    expect(updated[0].retries).toBe(1);
  });

  it("drops item after max retries", async () => {
    await enqueue("submission", { a: 1 });
    const queue = await getQueue();
    const id = queue[0].id;

    // Retry 5 times (MAX_RETRIES = 5)
    for (let i = 0; i < 4; i++) {
      await markRetry(id);
    }
    const willRetry = await markRetry(id);
    expect(willRetry).toBe(false);
    expect(await getQueueSize()).toBe(0);
  });

  it("clears all items", async () => {
    await enqueue("submission", { a: 1 });
    await enqueue("submission", { b: 2 });
    await clearQueue();
    expect(await getQueueSize()).toBe(0);
  });

  it("returns false for markRetry on non-existent item", async () => {
    const result = await markRetry("nonexistent");
    expect(result).toBe(false);
  });
});
