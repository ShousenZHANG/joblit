import { describe, it, expect } from "vitest";
import { createSerialRunner } from "./serialRunner";

describe("createSerialRunner", () => {
  it("never runs more than one task at a time", async () => {
    const run = createSerialRunner();
    let inflight = 0;
    let maxInflight = 0;
    const task = () => async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return true;
    };
    await Promise.all([run(task()), run(task()), run(task()), run(task())]);
    expect(maxInflight).toBe(1);
  });

  it("preserves submission order", async () => {
    const run = createSerialRunner();
    const order: number[] = [];
    const make = (n: number, delay: number) => () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          order.push(n);
          resolve();
        }, delay),
      );
    // First task is slowest — a parallel runner would let later (faster) tasks
    // finish first; a serial runner must keep 1,2,3.
    await Promise.all([run(make(1, 15)), run(make(2, 5)), run(make(3, 1))]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("keeps running later tasks after one rejects", async () => {
    const run = createSerialRunner();
    const done: string[] = [];
    const ok = run(async () => {
      done.push("a");
    });
    const bad = run(async () => {
      throw new Error("boom");
    });
    const after = run(async () => {
      done.push("c");
    });
    await ok;
    await expect(bad).rejects.toThrow("boom");
    await after;
    expect(done).toEqual(["a", "c"]);
  });

  it("returns each task's resolved value to its own caller", async () => {
    const run = createSerialRunner();
    const [a, b] = await Promise.all([
      run(async () => "first"),
      run(async () => "second"),
    ]);
    expect(a).toBe("first");
    expect(b).toBe("second");
  });
});
