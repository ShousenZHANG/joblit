import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import MarketingPage, { generateMetadata } from "./page";
import messages from "../../messages/en.json";

const { locale } = vi.hoisted(() => ({ locale: { value: "en" } }));
vi.mock("next-intl/server", () => ({ getLocale: async () => locale.value }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/" }));
// The decorative WebGL module is isolated from the server-rendered content contract.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
afterEach(() => { cleanup(); locale.value = "en"; });

describe("MarketingPage", () => {
  it("keeps product content, working anchors and CTAs available without WebGL", async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}>{await MarketingPage()}</NextIntlClientProvider>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your next chapter.");
    expect(document.getElementById("main-content")).toHaveAttribute("tabindex", "-1");
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(document.getElementById(anchor.hash.slice(1)), `Missing target ${anchor.hash}`).not.toBeNull();
    }
    const workspace = screen.getAllByRole("link", { name: /open workspace/i });
    expect(workspace.length).toBeGreaterThan(0);
    for (const link of workspace) expect(link).toHaveAttribute("href", "/login?callbackUrl=/jobs");
    expect(screen.getByRole("group", { name: /interactive product demo/i })).toBeInTheDocument();
    expect(document.querySelector('script[type="application/ld+json"]')).not.toHaveTextContent('"price"');
  });

  it("localizes search metadata for Chinese visitors", async () => {
    locale.value = "zh";
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("下一份理想工作，从这里开始");
    expect(metadata.description).toContain("澳洲");
  });
});
