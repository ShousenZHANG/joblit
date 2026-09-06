import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { ApplicationDemo } from "./ApplicationDemo";
import { DEMO_JOBS, DEMO_PROFILE, DEMO_SKILLS } from "./ApplicationDemo.data";

function demo(locale = "en", theme = "light") {
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><div data-testid="theme-boundary" data-theme={theme}><ApplicationDemo /></div></NextIntlClientProvider>;
}
function jobList() { return screen.getByRole("complementary", { name: "Sample jobs" }); }
function filterButtons() { return within(screen.getByRole("group", { name: "Filter jobs by status" })); }
function workspaceTabs() { return within(screen.getByRole("tablist", { name: "Sample workspace navigation" })); }

const network = () => vi.spyOn(globalThis, "fetch");
const persistence = () => vi.spyOn(Storage.prototype, "setItem");
let fetchSpy: ReturnType<typeof network>;
let storageSpy: ReturnType<typeof persistence>;
const originalMatchMedia = window.matchMedia;

describe("ApplicationDemo", () => {
  beforeEach(() => { fetchSpy = network(); storageSpy = persistence(); });
  afterEach(() => {
    // The entire interaction surface must stay anonymous and in memory.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
    cleanup(); vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
  });

  it.each([{ width: 640, reducedMotion: false }, { width: 640, reducedMotion: true }, { width: 1280, reducedMotion: false }])("moves focus and scrolls between mobile panes at $width px with reduced motion $reducedMotion", async ({ width, reducedMotion }) => {
    const user = userEvent.setup();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    window.matchMedia = (query) => {
      const maximumWidth = /max-width:\s*(\d+)px/.exec(query);
      return { ...originalMatchMedia(query), matches: maximumWidth ? width <= Number(maximumWidth[1]) : query.includes("prefers-reduced-motion") && reducedMotion };
    };
    render(demo());
    const card = within(jobList()).getByRole("button", { name: /Junior Full Stack Analyst Programmer/ });
    await user.click(card);
    if (width === 1280) {
      expect(card).toHaveFocus();
      expect(scroll).not.toHaveBeenCalled();
      return;
    }
    expect(screen.getByRole("heading", { name: DEMO_JOBS[1].title })).toHaveFocus();
    const back = screen.getByRole("button", { name: "All sample roles" });
    expect(scroll).toHaveBeenNthCalledWith(1, { block: "start", behavior: reducedMotion ? "instant" : "smooth" });
    expect(scroll.mock.contexts[0]).toBe(back.parentElement);
    await user.click(back);
    expect(card).toHaveFocus();
    expect(scroll).toHaveBeenNthCalledWith(2, { block: "start", behavior: reducedMotion ? "instant" : "smooth" });
    expect(scroll.mock.contexts[1]).toBe(card);
    // Reopening the already-selected job still hands focus into its pane.
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: DEMO_JOBS[1].title })).toHaveFocus();
  });

  it("searches and selects roles, focuses their experience evidence, and filters actual local statuses", async () => {
    const user = userEvent.setup();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(demo());
    const search = screen.getByRole("textbox", { name: "Search saved jobs" });
    await user.type(search, "Full Stack");
    expect(within(jobList()).getAllByRole("listitem")).toHaveLength(1);
    await user.click(within(jobList()).getByRole("button", { name: /Junior Full Stack Analyst Programmer/ }));
    expect(screen.getByRole("heading", { name: DEMO_JOBS[1].title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open job/ })).toHaveAttribute("href", "/demo/fullstack-job.html");
    await user.click(screen.getByRole("button", { name: "View in JD" }));
    const evidence = screen.getByText(DEMO_JOBS[1].source);
    expect(evidence.tagName).toBe("MARK");
    expect(evidence.parentElement).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    await user.clear(search);
    const descriptionViewport = screen.getByRole("region", { name: "Job description" }).parentElement!;
    descriptionViewport.scrollTop = 300;
    await user.selectOptions(screen.getByRole("combobox", { name: "Job status" }), "APPLIED");
    expect(descriptionViewport.scrollTop).toBe(0);
    expect(within(jobList()).getAllByRole("listitem")).toHaveLength(2);
    await user.click(filterButtons().getByRole("button", { name: "Applied" }));
    expect(within(jobList()).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Job status" })).toHaveValue("APPLIED");
    await user.click(filterButtons().getByRole("button", { name: /New/ }));
    expect(within(jobList()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("opens Tailor inside Jobs and prepares each document independently with truthful PDF and review content", async () => {
    const user = userEvent.setup();
    render(demo());
    await user.click(within(jobList()).getByRole("button", { name: /AI Systems Engineer/ }));
    const opener = screen.getByRole("button", { name: "Tailor" });
    await user.click(opener);
    const modal = screen.getByRole("dialog", { name: "Tailor this application" });
    // A perspective ancestor would turn this viewport-fixed modal into a
    // chapter-relative overlay and clip its backdrop during scrolling.
    expect(modal.closest("[data-scroll-chapter]")).toBeNull();
    expect(within(modal).getByRole("heading", { name: "Tailor this application" })).toHaveFocus();
    expect(within(modal).getByRole("tab", { name: "Resume" })).toHaveAttribute("aria-selected", "true");
    expect(within(modal).queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    expect(within(modal).queryByRole("link", { name: /Open sample PDF/ })).not.toBeInTheDocument();
    expect(modal).not.toHaveTextContent("Your edits save automatically");
    await user.click(within(modal).getByRole("button", { name: "Show generated example" }));
    expect(within(modal).getByRole("status")).toHaveFocus();
    expect(within(modal).getByRole("link", { name: /Open sample PDF/ })).toHaveAttribute("href", "/demo/ai-resume.pdf");
    expect(within(modal).getByRole("link", { name: /Open sample PDF/ })).toHaveAttribute("target", "_blank");
    await user.click(within(modal).getByRole("button", { name: "Review" }));
    expect(within(modal).getByText(DEMO_JOBS[2].summary)).toBeInTheDocument();
    expect(within(modal).getAllByRole("listitem").map((item) => item.textContent)).toEqual(DEMO_JOBS[2].skills.map((index) => DEMO_SKILLS[index]));
    expect(within(modal).queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(within(modal).getByText("Compare with the original summary"));
    expect(within(modal).getByText(DEMO_PROFILE.summary)).toBeVisible();
    await user.click(within(modal).getByRole("button", { name: "View published sample" }));
    expect(within(modal).getByText(en.landingExperience.demo.staticPdfNote)).toBeVisible();
    await user.click(within(modal).getByRole("tab", { name: "Cover Letter" }));
    expect(within(modal).queryByRole("link", { name: /Open sample PDF/ })).not.toBeInTheDocument();
    await user.click(within(modal).getByRole("button", { name: "Show generated example" }));
    expect(within(modal).getByRole("link", { name: /Open sample PDF/ })).toHaveAttribute("href", "/demo/ai-cover.pdf");
    await user.click(within(modal).getByRole("button", { name: "Review" }));
    for (const paragraph of DEMO_JOBS[2].cover) expect(within(modal).getByText(paragraph)).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(workspaceTabs().getByRole("tab", { name: "Jobs" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Job status" })).toHaveValue("NEW");
    await user.click(screen.getByRole("button", { name: "Saved CL" }));
    expect(screen.getByRole("tab", { name: "Cover Letter, Published sample" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Back to Jobs" }));
    await user.click(screen.getByRole("button", { name: "Saved CV" }));
    expect(screen.getByRole("tab", { name: "Resume, Published sample" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps its modal inside the theme boundary without resetting it and restores keyboard focus", async () => {
    const user = userEvent.setup();
    const { rerender } = render(demo());
    const opener = screen.getByRole("button", { name: "Tailor" });
    await user.click(opener);
    const modal = screen.getByRole("dialog");
    expect(screen.getByTestId("theme-boundary")).toContainElement(modal);
    await user.click(within(modal).getByRole("button", { name: "Show generated example" }));
    rerender(demo("en", "dark"));
    expect(screen.getByRole("dialog")).toBe(modal);
    expect(modal.closest("[data-theme]")).toHaveAttribute("data-theme", "dark");
    const resume = within(modal).getByRole("tab", { name: "Resume, Published sample" });
    resume.focus();
    await user.keyboard("{ArrowRight}");
    expect(within(modal).getByRole("tab", { name: "Cover Letter" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(within(modal).getByRole("link", { name: /Open sample PDF/ })).toHaveAttribute("href", "/demo/powerapps-resume.pdf");
    within(modal).getByRole("button", { name: "Back to Jobs" }).focus();
    await user.tab();
    expect(modal).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("recovers from search and status dead ends through Fetch and restores removed samples", async () => {
    const user = userEvent.setup();
    render(demo());
    await user.selectOptions(screen.getByRole("combobox", { name: "Job status" }), "APPLIED");
    await user.click(filterButtons().getByRole("button", { name: "Rejected" }));
    await user.type(screen.getByRole("textbox", { name: "Search saved jobs" }), "not a role");
    await user.click(workspaceTabs().getByRole("tab", { name: "Fetch" }));
    await user.click(screen.getByRole("button", { name: "Explore sample roles" }));
    expect(screen.getByRole("textbox", { name: "Search saved jobs" })).toHaveValue("");
    expect(screen.getByRole("heading", { name: DEMO_JOBS[0].title })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Job status" })).toHaveValue("APPLIED");
    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    for (let index = 0; index < 3; index += 1) await user.click(screen.getByRole("button", { name: "Remove sample job" }));
    expect(within(jobList()).getByText(en.landingExperience.demo.emptyRemoved)).toBeVisible();
    await user.click(within(jobList()).getByRole("button", { name: "Restore sample roles" }));
    expect(within(jobList()).getAllByRole("listitem")).toHaveLength(3);
  });

  it("resets per-job documents as well as triage, and keeps source Resume separate from Tailor", async () => {
    const user = userEvent.setup();
    render(demo());
    await user.click(screen.getByRole("button", { name: "Tailor" }));
    await user.click(screen.getByRole("button", { name: "Show generated example" }));
    await user.keyboard("{Escape}");
    await user.click(within(jobList()).getByRole("button", { name: /Junior Full Stack Analyst Programmer/ }));
    expect(screen.queryByRole("button", { name: "Saved CV" })).not.toBeInTheDocument();
    await user.click(workspaceTabs().getByRole("tab", { name: "Resume" }));
    expect(screen.getByText(DEMO_PROFILE.summary)).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(within(jobList()).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Saved CV" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tailor" }));
    expect(screen.getByRole("button", { name: "Show generated example" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open sample PDF/ })).not.toBeInTheDocument();
  });

  it("provides localized keyboard navigation and accessible initial and modal states", async () => {
    const user = userEvent.setup();
    const { container } = render(demo("zh"));
    const jobs = screen.getByRole("tab", { name: "职位" });
    jobs.focus(); await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "获取" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "简历" })).toHaveFocus();
    expect(await axe(container)).toHaveNoViolations();
    await user.keyboard("{Home}");
    await user.click(screen.getByRole("button", { name: "Tailor 定制" }));
    expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations();
  });
});
