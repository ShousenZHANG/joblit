import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import HomePage from "./page";
import messages from "../../messages/en.json";

// Mock next-intl/server for server component
vi.mock("next-intl/server", () => ({
  getTranslations: (ns: string) => {
    return Promise.resolve((key: string) => {
      const map = messages as Record<string, Record<string, string>>;
      return map[ns]?.[key] ?? `${ns}.${key}`;
    });
  },
}));

afterEach(cleanup);

async function renderPage() {
  const Page = await HomePage();
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {Page}
    </NextIntlClientProvider>,
  );
}

describe("HomePage", () => {
  it("pre-fills the demo fields to avoid an empty flash", async () => {
    await renderPage();

    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
    expect(screen.getByText("Mid-level")).toBeInTheDocument();
  });

  it("uses correct semantic structure with a single main landmark", async () => {
    await renderPage();

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
  });

  it("renders hero and CTA", async () => {
    await renderPage();

    expect(screen.getByText("Find the right roles, faster")).toBeInTheDocument();
    const ctaLinks = screen.getAllByRole("link", { name: /Start free/i });
    expect(ctaLinks.length).toBeGreaterThanOrEqual(1);
    expect(ctaLinks[0]).toHaveAttribute("href", "/login");
  });

  it("includes a skip-to-content link for accessibility", async () => {
    await renderPage();

    const skipLink = screen.getByText("Skip to content");
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });
});
