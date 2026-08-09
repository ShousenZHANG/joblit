import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRunnerPresence } from "./useRunnerPresence";

function PresenceProbe({ enabled = true, name = "presence" }) {
  const presence = useRunnerPresence(enabled);
  return <output data-testid={name}>{presence.status}</output>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useRunnerPresence", () => {
  it("reports an unavailable status when the presence service cannot be checked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    render(<PresenceProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("presence")).toHaveTextContent("unavailable"),
    );
  });

  it("shares one observed Runner state with passive consumers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ lastUsedAt: new Date().toISOString() }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    render(
      <>
        <PresenceProbe name="active" />
        <PresenceProbe enabled={false} name="passive" />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("online"),
    );
    expect(screen.getByTestId("passive")).toHaveTextContent("online");
  });

  it("rechecks an offline Runner within five seconds without a page refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    let online = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: online ? "online" : "offline",
              lastUsedAt: online ? new Date().toISOString() : null,
              checkedAt: new Date().toISOString(),
              onlineWindowMs: 90_000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    render(<PresenceProbe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("presence")).toHaveTextContent("offline");

    online = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId("presence")).toHaveTextContent("online");
  });

  it("uses the server clock for online TTL when the browser clock is skewed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "online",
          lastUsedAt: "2026-08-09T10:00:00.000Z",
          checkedAt: "2026-08-09T10:00:10.000Z",
          onlineWindowMs: 90_000,
        }),
      ),
    );

    render(<PresenceProbe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("presence")).toHaveTextContent("online");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(79_000);
    });
    expect(screen.getByTestId("presence")).toHaveTextContent("online");
  });

  it("rechecks an online Runner every twenty seconds and stops after unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "online",
        lastUsedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        onlineWindowMs: 90_000,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<PresenceProbe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
