import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import { resetToasts } from "@/hooks/use-toast";
import { RunnerSetupPopover } from "./RunnerSetupPopover";

afterEach(() => {
  cleanup();
  resetToasts();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderPopover() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RunnerSetupPopover />
    </NextIntlClientProvider>,
  );
}

describe("RunnerSetupPopover", () => {
  it("updates the global connection dot without opening the panel", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    let online = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/agent-tokens") {
          return Response.json({ data: [] });
        }
        return Response.json({
          status: online ? "online" : "offline",
          lastUsedAt: online ? new Date().toISOString() : null,
          checkedAt: new Date().toISOString(),
          onlineWindowMs: 90_000,
        });
      }),
    );

    renderPopover();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId("runner-online-dot")).not.toBeInTheDocument();

    online = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId("runner-online-dot")).toBeInTheDocument();
  });

  it("shows a retryable credential error instead of pretending setup is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/agent-tokens") {
          return new Response("unavailable", { status: 503 });
        }
        if (url === "/api/agent/presence") {
          return new Response(
            JSON.stringify({
              status: "offline",
              lastUsedAt: null,
              checkedAt: new Date().toISOString(),
              onlineWindowMs: 90_000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByTestId("runner-setup-trigger"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.runnerSetup.loadError,
    );
    expect(
      screen.getByRole("button", { name: en.runnerSetup.retry }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.runnerSetup.createCredential }),
    ).not.toBeInTheDocument();
  });

  it("never offers a copy action for an unrecoverable stored credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/agent-tokens") {
          return Response.json({
            data: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                name: "Joblit Runner",
                lastUsedAt: null,
                expiresAt: "2026-12-01T00:00:00.000Z",
                createdAt: "2026-08-01T00:00:00.000Z",
              },
            ],
          });
        }
        return Response.json({
          status: "offline",
          lastUsedAt: null,
          checkedAt: new Date().toISOString(),
          onlineWindowMs: 90_000,
        });
      }),
    );

    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByTestId("runner-setup-trigger"));

    expect(
      await screen.findByText(en.runnerSetup.credentialHidden),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: en.runnerSetup.copy }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/jfagent_v1_/)).not.toBeInTheDocument();
  });

  it("confirms replacement and creates the new credential before revoking the old one", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/agent/presence") {
          return Response.json({
            status: "offline",
            lastUsedAt: null,
            checkedAt: new Date().toISOString(),
            onlineWindowMs: 90_000,
          });
        }
        if (method === "POST") {
          calls.push("POST");
          return Response.json(
            {
              data: {
                id: "44444444-4444-4444-8444-444444444444",
                rawToken: `jfagent_v1_${"a".repeat(64)}`,
                expiresAt: "2026-12-01T00:00:00.000Z",
              },
            },
            { status: 201 },
          );
        }
        if (method === "DELETE") {
          calls.push("DELETE");
          return Response.json({ data: { revoked: true } });
        }
        return Response.json({
          data: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Old Runner",
              lastUsedAt: null,
              expiresAt: "2026-12-01T00:00:00.000Z",
              createdAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        });
      }),
    );

    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByTestId("runner-setup-trigger"));
    await user.click(await screen.findByTestId("runner-setup-regenerate"));

    expect(await screen.findByRole("alertdialog")).toBeVisible();
    expect(calls).toEqual([]);
    await user.click(
      screen.getByRole("button", { name: en.runnerSetup.replaceConfirm }),
    );

    await screen.findByText(en.runnerSetup.rawTokenOnce);
    expect(calls).toEqual(["POST", "DELETE"]);
    expect(screen.getByText(/\$env:JOBLIT_URL=/)).toHaveTextContent(
      "jfagent_v1_",
    );

    await user.click(screen.getByRole("button", { name: "Bash" }));
    expect(screen.getByText(/^JOBLIT_URL=/)).toHaveTextContent(
      "node tools/runner/cli.mjs --watch",
    );
  });

  it("keeps the old credential when replacement creation fails", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/agent/presence") {
          return Response.json({
            status: "offline",
            lastUsedAt: null,
            checkedAt: new Date().toISOString(),
            onlineWindowMs: 90_000,
          });
        }
        if (method === "POST") {
          calls.push("POST");
          return Response.json({ error: "unavailable" }, { status: 503 });
        }
        if (method === "DELETE") {
          calls.push("DELETE");
          return Response.json({ data: { revoked: true } });
        }
        return Response.json({
          data: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Working Runner",
              lastUsedAt: null,
              expiresAt: "2026-12-01T00:00:00.000Z",
              createdAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        });
      }),
    );

    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByTestId("runner-setup-trigger"));
    await user.click(await screen.findByTestId("runner-setup-regenerate"));
    await user.click(
      await screen.findByRole("button", {
        name: en.runnerSetup.replaceConfirm,
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("runner-setup-regenerate")).not.toBeDisabled(),
    );
    expect(calls).toEqual(["POST"]);
    expect(screen.getByText(en.runnerSetup.credentialHidden)).toBeVisible();
  });
});
