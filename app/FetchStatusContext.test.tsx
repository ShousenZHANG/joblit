import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

import {
  FetchStatusProvider,
  useFetchStatus,
  type FetchRunLane,
  type FetchRunStatus,
} from "./FetchStatusContext";

let current:
  | {
      status: FetchRunStatus | null;
      lanes: FetchRunLane[];
      cancelling: boolean;
      cancelError: string | null;
      startRuns: (
        runs: Array<{ id: string; source: "jobspy" | "seek" }>,
      ) => void;
      cancelRun: () => Promise<void>;
    }
  | undefined;

function Probe() {
  const value = useFetchStatus();
  useEffect(() => {
    current = {
      status: value.status,
      lanes: value.lanes,
      cancelling: value.cancelling,
      cancelError: value.cancelError,
      startRuns: value.startRuns,
      cancelRun: value.cancelRun,
    };
  }, [value]);
  return <div data-testid="status">{value.status ?? "idle"}</div>;
}

function renderProvider() {
  return render(
    <FetchStatusProvider>
      <Probe />
    </FetchStatusProvider>,
  );
}

describe("FetchStatusProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    current = undefined;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not claim cancellation succeeded when the API rejects it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "ALREADY_FINISHED" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderProvider();

    await act(async () =>
      current?.startRuns([{ id: "run-1", source: "jobspy" }]),
    );
    await act(async () => current?.cancelRun());

    expect(current?.status).toBe("QUEUED");
    expect(current?.lanes.map((lane) => lane.id)).toEqual(["run-1"]);
    expect(current?.cancelError).toBe(
      "Some fetch runs could not be cancelled. They are still being monitored.",
    );
  });

  it("uses the server's PARTIAL projection for a mid-stream cancellation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return new Response(
          JSON.stringify(
            url.endsWith("/cancel")
              ? { ok: true, status: "PARTIAL" }
              : {
                  run: {
                    status: "PARTIAL",
                    importedCount: 2,
                    error: "Cancelled by user",
                  },
                },
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );
    renderProvider();

    await act(async () =>
      current?.startRuns([{ id: "run-1", source: "jobspy" }]),
    );
    await act(async () => current?.cancelRun());

    expect(current?.status).toBe("PARTIAL");
  });

  it("deduplicates repeated cancellation attempts while one is in flight", async () => {
    let resolveCancel:
      | ((response: Response) => void)
      | undefined;
    const pendingCancel = new Promise<Response>((resolve) => {
      resolveCancel = resolve;
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/cancel")) return pendingCancel;
        return new Response(
          JSON.stringify({
            run: { status: "RUNNING", importedCount: 0, error: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();

    await act(async () =>
      current?.startRuns([{ id: "run-1", source: "jobspy" }]),
    );
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = current?.cancelRun();
      second = current?.cancelRun();
    });

    expect(first).toBeInstanceOf(Promise);
    expect(second).toBeInstanceOf(Promise);
    expect(first).toBe(second);
    expect(current?.cancelling).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/cancel"),
      ),
    ).toHaveLength(1);

    await act(async () => {
      resolveCancel?.(
        new Response(JSON.stringify({ ok: true, status: "FAILED" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await first;
    });

    expect(current?.cancelling).toBe(false);
    expect(current?.status).toBe("FAILED");
  });

  it("does not let an older poll regress a confirmed cancellation", async () => {
    vi.useFakeTimers();
    let resolvePoll: ((response: Response) => void) | undefined;
    const pendingPoll = new Promise<Response>((resolve) => {
      resolvePoll = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/cancel")) {
          return new Response(
            JSON.stringify({ ok: true, status: "FAILED" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return pendingPoll;
      }),
    );
    renderProvider();

    await act(async () =>
      current?.startRuns([{ id: "run-1", source: "jobspy" }]),
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => current?.cancelRun());
    expect(current?.status).toBe("FAILED");

    await act(async () => {
      resolvePoll?.(
        new Response(
          JSON.stringify({
            run: { status: "RUNNING", importedCount: 0, error: null },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current?.status).toBe("FAILED");
  });

  it("updates successful lanes while retaining failed cancellations for polling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("run-partial") && url.endsWith("/cancel")) {
          return new Response(
            JSON.stringify({ ok: true, status: "PARTIAL" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({ error: "private-upstream-detail" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );
    renderProvider();

    await act(async () =>
      current?.startRuns([
        { id: "run-partial", source: "jobspy" },
        { id: "run-still-active", source: "seek" },
      ]),
    );
    await act(async () => current?.cancelRun());

    expect(
      current?.lanes.map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: "run-partial", status: "PARTIAL" },
      { id: "run-still-active", status: "QUEUED" },
    ]);
    expect(current?.cancelError).not.toContain("private-upstream-detail");
    expect(current?.cancelling).toBe(false);
  });

  it("clears an earlier cancellation error when a new run set starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("sensitive service response", { status: 500 }),
      ),
    );
    renderProvider();

    await act(async () =>
      current?.startRuns([{ id: "run-1", source: "jobspy" }]),
    );
    await act(async () => current?.cancelRun());
    expect(current?.cancelError).not.toBeNull();

    await act(async () =>
      current?.startRuns([{ id: "run-2", source: "seek" }]),
    );

    expect(current?.cancelError).toBeNull();
    expect(current?.cancelling).toBe(false);
    expect(current?.lanes.map((lane) => lane.id)).toEqual(["run-2"]);
  });

  it("keeps monitoring a legitimate run after eight minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            run: {
              status: "RUNNING",
              importedCount: 0,
              error: null,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );
    renderProvider();

    await act(async () =>
      current?.startRuns([{ id: "run-1", source: "jobspy" }]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(current?.status).toBe("RUNNING");

    vi.setSystemTime(new Date("2026-07-20T00:09:00.000Z"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_001);
    });

    expect(current?.status).toBe("RUNNING");
  });

  it("treats PARTIAL as terminal and stops polling", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          run: {
            status: "PARTIAL",
            importedCount: 2,
            error: "A later batch failed",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();

    await act(async () =>
      current?.startRuns([{ id: "run-1", source: "jobspy" }]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(current?.status).toBe("PARTIAL");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aggregates mixed success and failure lanes as PARTIAL", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const status = url.includes("run-success") ? "SUCCEEDED" : "FAILED";
        return new Response(
          JSON.stringify({
            run: { status, importedCount: status === "SUCCEEDED" ? 1 : 0 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );
    renderProvider();

    await act(async () =>
      current?.startRuns([
        { id: "run-success", source: "jobspy" },
        { id: "run-failed", source: "seek" },
      ]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(current?.status).toBe("PARTIAL");
  });
});
