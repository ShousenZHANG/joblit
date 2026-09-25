import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { Landing } from "./Landing";

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));

const READING_PATH = ["overview", "how-it-works", "demo", "your-model", "details", "get-started", "faq", "start"];

function renderLanding(locale: "en" | "zh" = "en") {
  return render(<NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><Landing /></NextIntlClientProvider>);
}

describe("Landing", () => {
  afterEach(cleanup);

  it("leads with one product claim and a grounded example of it", () => {
    renderLanding();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(`${en.landingExperience.hero.titleLead} ${en.landingExperience.hero.titleClaim}`);
    expect(screen.getByRole("figure", { name: en.landingExperience.proof.label })).toBeInTheDocument();
  });

  it("orders the sections as a reading path, each named by its own heading", () => {
    renderLanding();
    const main = document.getElementById("main-content")!;
    expect(main).toHaveAttribute("tabindex", "-1");
    // The demo keeps a wrapper around its section for its dialog portal.
    const sections = [...main.querySelectorAll("section[id]")];
    expect(sections.map(section => section.id)).toEqual(READING_PATH);
    for (const section of sections) {
      const heading = document.getElementById(section.getAttribute("aria-labelledby")!);
      expect(heading, `#${section.id} is not labelled by a heading`).not.toBeNull();
      expect(heading!.tagName).toMatch(/^H[12]$/);
      expect(section).toContainElement(heading);
    }
  });

  it("resolves every in-page link and routes every workspace link to sign-in", () => {
    renderLanding();
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(document.getElementById(anchor.hash.slice(1)), `Missing target ${anchor.hash}`).not.toBeNull();
    }
    const starts = screen.getAllByRole("link", { name: en.landing.nav.startFree });
    expect(starts.length).toBeGreaterThanOrEqual(3);
    const footer = screen.getByRole("contentinfo");
    const workspace = within(footer).getByRole("link", { name: en.landingExperience.footer.workspace });
    for (const link of [...starts, workspace]) expect(link).toHaveAttribute("href", "/login?callbackUrl=/jobs");
  });

  it("states that the server holds no model key", () => {
    renderLanding();
    const diagram = screen.getByRole("figure", { name: en.landingExperience.yourModel.diagramLabel });
    expect(within(diagram).getByText(en.landingExperience.yourModel.noKey)).toBeInTheDocument();
  });

  it("keeps the FAQ in native disclosures", () => {
    renderLanding();
    const faq = document.getElementById("faq")!;
    const items = faq.querySelectorAll("details");
    expect(items).toHaveLength(en.landingExperience.faq.items.length);
    items.forEach((item, index) => {
      expect(item.querySelector("summary")).toHaveTextContent(en.landingExperience.faq.items[index].question);
    });
  });

  it.each(["en", "zh"] as const)("renders the complete page without accessibility violations in %s", async locale => {
    const { container } = renderLanding(locale);
    const messages = locale === "zh" ? zh : en;
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`${messages.landingExperience.hero.titleLead} ${messages.landingExperience.hero.titleClaim}`);
    expect(await axe(container)).toHaveNoViolations();
  });
});
