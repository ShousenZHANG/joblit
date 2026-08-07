import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import { RunnerPresenceChip } from "./RunnerPresenceChip";

/**
 * The chip never guesses: online within the six-minute window, offline
 * beyond it, and nothing at all while presence is unknown (a failed poll is
 * not evidence either way).
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubPresence(lastUsedAt: string | null, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ lastUsedAt }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

function renderChip(props?: { linkToSetup?: boolean }) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RunnerPresenceChip {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RunnerPresenceChip", () => {
  it("shows online with minutes when the credential was used recently", async () => {
    stubPresence(new Date(Date.now() - 3 * 60_000).toISOString());
    renderChip();

    const chip = await screen.findByTestId("runner-presence-chip");
    expect(chip).toHaveAttribute("data-status", "online");
    expect(chip).toHaveTextContent(/active 3m ago/i);
  });

  it("shows offline with a setup link once activity falls out of the window", async () => {
    stubPresence(new Date(Date.now() - 30 * 60_000).toISOString());
    renderChip({ linkToSetup: true });

    const chip = await screen.findByTestId("runner-presence-chip");
    expect(chip).toHaveAttribute("data-status", "offline");
    expect(chip).toHaveTextContent(/runner offline/i);
    expect(screen.getByRole("link", { name: /set up/i })).toHaveAttribute(
      "href",
      "/agent",
    );
  });

  it("treats never-used credentials as offline", async () => {
    stubPresence(null);
    renderChip();

    const chip = await screen.findByTestId("runner-presence-chip");
    expect(chip).toHaveAttribute("data-status", "offline");
  });

  it("renders nothing when the poll fails — no false verdict", async () => {
    stubPresence(null, 500);
    renderChip();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      screen.queryByTestId("runner-presence-chip"),
    ).not.toBeInTheDocument();
  });
});
