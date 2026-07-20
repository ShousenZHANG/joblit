import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

import {
  FetchStatusProvider,
  useFetchStatus,
  type FetchRunStatus,
} from "./FetchStatusContext";

let current:
  | {
      status: FetchRunStatus | null;
      startRuns: (runs: [{ id: string; source: "jobspy" }]) => void;
      cancelRun: () => Promise<void>;
    }
  | undefined;

function Probe() {
  const value = useFetchStatus();
  useEffect(() => {
    current = {
      status: value.status,
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

    act(() => current?.startRuns([{ id: "run-1", source: "jobspy" }]));
    await act(async () => current?.cancelRun());

    expect(current?.status).toBe("QUEUED");
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

    act(() => current?.startRuns([{ id: "run-1", source: "jobspy" }]));
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
});
