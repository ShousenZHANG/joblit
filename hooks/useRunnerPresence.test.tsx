import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginRunnerConnectionCheck,
  cancelRunnerConnectionCheck,
  useRunnerPresence,
} from "./useRunnerPresence";

function PresenceProbe({ enabled = true, name = "presence" }) {
  const presence = useRunnerPresence(enabled);
  return (
    <output data-testid={name}>
      {presence.status}
      {presence.status === "online" && presence.checkDelayed
        ? ":check-delayed"
        : ""}
    </output>
  );
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

  it("keeps the last known online state when a presence recheck is temporarily unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    let checks = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        checks += 1;
        if (checks === 1) {
          return Response.json({
            status: "online",
            lastUsedAt: "2026-08-09T10:00:00.000Z",
            checkedAt: "2026-08-09T10:00:00.000Z",
            onlineWindowMs: 90_000,
          });
        }
        return new Response("temporarily unavailable", { status: 503 });
      }),
    );

    render(<PresenceProbe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("presence")).toHaveTextContent("online");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByTestId("presence")).toHaveTextContent(
      "online:check-delayed",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(69_999);
    });
    expect(screen.getByTestId("presence")).toHaveTextContent("online");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId("presence")).not.toHaveTextContent("online");
  });

  it("shares a one-second connection burst and stops it as soon as the Runner is online", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    let checks = 0;
    const fetchMock = vi.fn(async () => {
      checks += 1;
      const online = checks >= 3;
      return Response.json({
        status: online ? "online" : "offline",
        lastUsedAt: online ? new Date().toISOString() : null,
        checkedAt: new Date().toISOString(),
        onlineWindowMs: 90_000,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <>
        <PresenceProbe name="one" />
        <PresenceProbe name="two" />
      </>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.all([
        beginRunnerConnectionCheck(),
        beginRunnerConnectionCheck(),
      ]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("one")).toHaveTextContent("online");
    expect(screen.getByTestId("two")).toHaveTextContent("online");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ignores an older online Runner until the replacement credential is observed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    const oldCredentialId = "33333333-3333-4333-8333-333333333333";
    const replacementId = "44444444-4444-4444-8444-444444444444";
    let replacementChecks = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("credentialId=")) {
        return Response.json({
          status: "online",
          credentialId: oldCredentialId,
          lastUsedAt: new Date().toISOString(),
          checkedAt: new Date().toISOString(),
          onlineWindowMs: 90_000,
        });
      }

      replacementChecks += 1;
      // A stale/intermediate response must not satisfy the replacement burst,
      // even if it still says that some Runner is online.
      const observedCredentialId =
        replacementChecks >= 3 ? replacementId : oldCredentialId;
      return Response.json({
        status: "online",
        credentialId: observedCredentialId,
        lastUsedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        onlineWindowMs: 90_000,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PresenceProbe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("presence")).toHaveTextContent("online");

    await act(async () => {
      await Promise.all([
        beginRunnerConnectionCheck(replacementId),
        beginRunnerConnectionCheck(replacementId),
      ]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `credentialId=${replacementId}`,
    );
    expect(screen.getByTestId("presence")).not.toHaveTextContent("online");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("presence")).not.toHaveTextContent("online");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId("presence")).toHaveTextContent("online");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("cancels the connection burst when its setup surface unmounts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "offline",
        lastUsedAt: null,
        checkedAt: new Date().toISOString(),
        onlineWindowMs: 90_000,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PresenceProbe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await beginRunnerConnectionCheck();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    cancelRunnerConnectionCheck();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
