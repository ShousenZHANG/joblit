import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import { TrendingPopover } from "./TrendingPopover";

/**
 * The panel is deliberately lazy: a nav glyph must not cost a network call on
 * every page load. It fetches on first open, caches per period for the
 * session, and degrades to a retry affordance rather than an empty box.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function repo(id: number, fullName: string, starsGained = 120) {
  return {
    id,
    fullName,
    description: `${fullName} description`,
    url: `https://github.com/${fullName}`,
    stars: 4200,
    forks: 300,
    starsGained,
    language: "TypeScript",
    topics: [],
    ownerAvatar: "",
    pushedAt: new Date().toISOString(),
  };
}

function renderPopover() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TrendingPopover />
    </NextIntlClientProvider>,
  );
}

describe("TrendingPopover", () => {
  it("fetches nothing until the panel is opened, then lists repos", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          repos: [repo(1, "openai/codex"), repo(2, "vercel/next.js")],
          cached: false,
          fetchedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderPopover();

    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("trending-trigger"));

    expect(await screen.findByText("openai/codex")).toBeInTheDocument();
    expect(screen.getByText("vercel/next.js")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/discover/trending?period=weekly");
  });

  it("requests the monthly board when the period is switched", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          repos: [
            String(input).includes("monthly")
              ? repo(3, "monthly/winner")
              : repo(1, "weekly/winner"),
          ],
          cached: false,
          fetchedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByTestId("trending-trigger"));
    await screen.findByText("weekly/winner");

    await user.click(screen.getByRole("button", { name: en.trending.periodMonth }));

    expect(await screen.findByText("monthly/winner")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/discover/trending?period=monthly");
  });

  it("offers a retry instead of an empty panel when GitHub is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );

    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByTestId("trending-trigger"));

    await waitFor(() =>
      expect(screen.getByText(en.trending.error)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: en.trending.retry }),
    ).toBeInTheDocument();
  });
});
