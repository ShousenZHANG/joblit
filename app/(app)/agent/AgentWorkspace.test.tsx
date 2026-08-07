import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import { AgentWorkspace } from "./AgentWorkspace";

/**
 * The onboarding stepper derives progress from the system instead of
 * narrating a static leaflet:
 * - the credential step checks itself off when a live credential exists, and
 *   creation is embedded in the step;
 * - the freshly minted raw token is injected into the copyable snippet — the
 *   only client-side place it ever exists;
 * - the connect step turns green from presence, and a fully green card
 *   collapses to one line.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const RAW = "jfagent_v1_secret_raw_value";

function stubApi(options: {
  tokens?: Array<Record<string, unknown>>;
  presence?: string | null;
}) {
  let tokens = options.tokens ?? [];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url === "/api/agent-tokens" && init?.method === "POST") {
      tokens = [
        ...tokens,
        {
          id: "tok-new",
          name: "Joblit Runner",
          lastUsedAt: null,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ];
      return json(
        {
          data: {
            id: "tok-new",
            rawToken: RAW,
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        },
        201,
      );
    }
    if (url === "/api/agent-tokens") return json({ data: tokens });
    if (url === "/api/agent/presence") {
      return json({ lastUsedAt: options.presence ?? null });
    }
    return json({ error: "not mocked" }, 500);
  });
}

function renderWorkspace() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AgentWorkspace origin="https://joblit.example.com" />
    </NextIntlClientProvider>,
  );
}

describe("AgentWorkspace onboarding", () => {
  it("starts with the credential step pending and a placeholder snippet", async () => {
    vi.stubGlobal("fetch", stubApi({ tokens: [], presence: null }));
    renderWorkspace();

    expect(
      await screen.findByRole("button", { name: /generate credential/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("setup-snippet")).toHaveTextContent(
      "jfagent_v1_...",
    );
    expect(screen.getByText(/waiting for the runner's first call/i)).toBeInTheDocument();
  });

  it("injects the freshly minted raw token into the snippet and checks the step off", async () => {
    vi.stubGlobal("fetch", stubApi({ tokens: [], presence: null }));
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(
      await screen.findByRole("button", { name: /generate credential/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("setup-snippet")).toHaveTextContent(RAW),
    );
    expect(
      screen.queryByRole("button", { name: /generate credential/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/only time it appears/i)).toBeInTheDocument();
  });

  it("collapses to a one-line summary when credentialed and connected", async () => {
    vi.stubGlobal(
      "fetch",
      stubApi({
        tokens: [
          {
            id: "tok-1",
            name: "Joblit Runner",
            lastUsedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        presence: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    renderWorkspace();

    const summary = await screen.findByTestId("runner-setup-collapsed");
    expect(summary).toHaveTextContent(/configured and online/i);
    expect(
      screen.queryByTestId("runner-setup-stepper"),
    ).not.toBeInTheDocument();

    // The full guide stays one click away.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /show setup guide/i }));
    expect(await screen.findByTestId("runner-setup-stepper")).toBeInTheDocument();
  });

  it("keeps the stepper visible while the Runner is credentialed but offline", async () => {
    vi.stubGlobal(
      "fetch",
      stubApi({
        tokens: [
          {
            id: "tok-1",
            name: "Joblit Runner",
            lastUsedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        presence: new Date(Date.now() - 3 * 3600_000).toISOString(),
      }),
    );
    renderWorkspace();

    expect(await screen.findByTestId("runner-setup-stepper")).toBeInTheDocument();
    expect(await screen.findByText(/you have an active credential/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for the runner's first call/i)).toBeInTheDocument();
  });
});
