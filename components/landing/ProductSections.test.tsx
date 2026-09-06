import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { ProductSections } from "./ProductSections";

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));

function renderSections(locale: "en" | "zh" = "en") {
  return render(<NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><ProductSections /></NextIntlClientProvider>);
}

describe("ProductSections progressive chapters", () => {
  afterEach(cleanup);

  it.each(["en", "zh"] as const)("keeps six labelled, readable chapters with stable navigation anchors in %s", async locale => {
    const { container } = renderSections(locale);
    const ids = ["features", "documents", "organise", "get-started", "faq", "start"];
    const chapters = screen.getAllByRole("region");
    expect(chapters).toHaveLength(ids.length);
    expect(chapters.map(chapter => chapter.id)).toEqual(ids);
    for (const chapter of chapters) {
      expect(chapter).toHaveAttribute("data-scroll-chapter");
      expect(chapter).toHaveAttribute("data-chapter-layout", "flow");
      expect(within(chapter).getByRole("heading", { level: 2 })).toBeVisible();
    }
    expect(chapters[5]).toHaveAttribute("data-chapter-closing", "true");
    expect(chapters[5].querySelector("footer")).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps FAQ answers in native disclosures alongside direct setup guidance", async () => {
    const user = userEvent.setup();
    renderSections();
    const faq = document.getElementById("faq")!;
    const items = faq.querySelectorAll("details");
    expect(items).toHaveLength(4);
    const question = items[1].querySelector("summary")!;
    expect(items[1].firstElementChild).toBe(question);
    await user.click(question);
    expect(items[1]).toHaveAttribute("open");
    expect(within(items[1]).getByText(en.landingExperience.faq.items[1].answer)).toBeVisible();
    await user.click(question);
    expect(items[1]).not.toHaveAttribute("open");
    const setup = within(document.getElementById("get-started")!).getByRole("link", { name: en.landingExperience.gettingStarted.setupLink });
    expect(setup).toHaveAttribute("href", "https://github.com/ShousenZHANG/joblit/blob/master/docs/adr/0024-generate-from-a-local-sidecar.md");
    expect(setup).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(en.landingExperience.gettingStarted.step3Description)).toBeVisible();
  });

  it("finishes with working workspace, demo and legal destinations", () => {
    renderSections();
    const closing = document.getElementById("start")!;
    expect(within(closing).getByRole("link", { name: en.landingExperience.finalCta.primary })).toHaveAttribute("href", "/login?callbackUrl=/jobs");
    expect(within(closing).getByRole("link", { name: en.landingExperience.finalCta.secondary })).toHaveAttribute("href", "#demo");
    const footer = closing.querySelector("footer")!;
    expect(within(footer).getByRole("link", { name: en.landingExperience.footer.privacy })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: en.landingExperience.footer.terms })).toHaveAttribute("href", "/terms");
  });
});
