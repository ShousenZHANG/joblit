import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import MarketingPage, { generateMetadata } from "./page";
import messages from "../../messages/en.json";

const { locale } = vi.hoisted(() => ({ locale: { value: "en" } }));
vi.mock("next-intl/server", () => ({ getLocale: async () => locale.value }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
afterEach(() => { cleanup(); locale.value = "en"; });

describe("MarketingPage", () => {
  it("serves the landing content, working CTAs and the demo with structured data", async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}>{await MarketingPage()}</NextIntlClientProvider>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`${messages.landingExperience.hero.titleLead} ${messages.landingExperience.hero.titleClaim}`);
    for (const link of screen.getAllByRole("link", { name: messages.landing.nav.startFree })) {
      expect(link).toHaveAttribute("href", "/login?callbackUrl=/jobs");
    }
    expect(screen.getByRole("group", { name: /interactive product demo/i })).toBeInTheDocument();
    expect(document.querySelector('script[type="application/ld+json"]')).not.toHaveTextContent('"price"');
  });

  it("localizes search metadata for Chinese visitors", async () => {
    locale.value = "zh";
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("为职位定制，忠于你的简历。");
    expect(metadata.description).toContain("澳洲");
  });
});
