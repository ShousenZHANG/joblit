import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import MarketingPage from "./page";
import messages from "../../messages/en.json";

// Mocks —
//   next-auth: SessionProvider is injected by a production layout, not by
//     the test; useSession() would throw otherwise.
//   next-themes: ThemeToggle renders a placeholder until mounted, so we
//     only need a stub that yields `resolvedTheme === "light"`.
//   framer-motion: spreads through data-testid passthrough, safe to leave.

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("next-themes", async () => {
  const actual = await vi.importActual<typeof import("next-themes")>(
    "next-themes",
  );
  return {
    ...actual,
    useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: vi.fn() }),
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

describe("MarketingPage", () => {
  it("renders all 14 landing sections", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MarketingPage />
      </NextIntlClientProvider>,
    );

    const required = [
      "landing-nav",
      "landing-hero",
      "landing-logobar",
      "landing-howitworks",
      "landing-features",
      "landing-deepdive-resume",
      "landing-deepdive-ats",
      "landing-deepdive-fetch",
      "landing-stats",
      "landing-testimonials",
      "landing-pricing",
      "landing-faq",
      "landing-cta",
      "landing-footer",
    ];

    for (const testid of required) {
      expect(
        screen.getByTestId(testid),
        `missing section: ${testid}`,
      ).toBeInTheDocument();
    }
  });
});
