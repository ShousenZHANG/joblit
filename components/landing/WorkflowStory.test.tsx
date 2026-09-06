import { useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { motionValue } from "framer-motion";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { WorkflowStory } from "./WorkflowStory";

function renderStory(locale: "en" | "zh" = "en", onStepChange = vi.fn(), options: { staticMode?: boolean; reducedMotion?: boolean } = {}) {
  function ControlledStory() {
    const [activeStep, setActiveStep] = useState(0);
    return <WorkflowStory activeStep={activeStep} onStepChange={(index) => { onStepChange(index); setActiveStep(index); }} {...options} />;
  }
  return { ...render(<NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><ControlledStory /></NextIntlClientProvider>), onStepChange };
}

describe("WorkflowStory", () => {
  afterEach(cleanup);

  it("keeps every chapter reachable while exposing only the selected chapter to assistive technology", async () => {
    const user = userEvent.setup();
    const { onStepChange } = renderStory();
    const steps = screen.getAllByRole("button");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("3+ years")).toBeVisible();

    await user.click(steps[1]);
    expect(onStepChange).toHaveBeenLastCalledWith(1);
    expect(steps[0]).not.toHaveAttribute("aria-current");
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(within(screen.getByRole("article")).getByText("React")).toBeInTheDocument();
    expect(document.getElementById(steps[1].getAttribute("aria-controls")!)).toBe(screen.getByRole("article"));
    const inactiveChapters = screen.getAllByRole("article", { hidden: true }).filter(chapter => chapter.getAttribute("aria-hidden") === "true");
    expect(inactiveChapters).toHaveLength(2);
    for (const chapter of inactiveChapters) expect(chapter).toHaveAttribute("inert");
    expect(steps[2]).toBeVisible();
  });

  it("supports native keyboard chapter selection and a direct escape to the demo", async () => {
    const user = userEvent.setup();
    const { container, onStepChange } = renderStory("zh");
    const steps = screen.getAllByRole("button");
    steps[1].focus();
    await user.keyboard("{Enter}");
    expect(onStepChange).toHaveBeenLastCalledWith(1);
    await user.tab();
    expect(steps[2]).toHaveFocus();
    await user.keyboard(" ");
    expect(onStepChange).toHaveBeenLastCalledWith(2);
    const chapter = screen.getByRole("article", { name: zh.landingExperience.story.steps[2].title });
    expect(within(chapter).getByText("Resume.pdf")).toBeInTheDocument();
    expect(within(chapter).getByText(zh.landingExperience.story.illustrative)).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("link", { name: zh.landingExperience.story.skip })).toHaveFocus();
    expect(screen.getByRole("link", { name: zh.landingExperience.story.skip })).toHaveAttribute("href", "#demo");
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([{ staticMode: true }, { reducedMotion: true }])("keeps all chapters readable without overlapping motion for %j", async options => {
    const { container } = renderStory("en", vi.fn(), options);
    const chapters = screen.getAllByRole("article");
    expect(chapters).toHaveLength(3);
    for (const button of screen.getAllByRole("button")) expect(button).not.toHaveAttribute("aria-current");
    for (const [index, chapter] of chapters.entries()) {
      expect(chapter).not.toHaveAttribute("aria-hidden");
      expect(chapter).not.toHaveAttribute("inert");
      expect(chapter).toHaveStyle({ opacity: 1 });
      expect(chapter).toHaveAttribute("data-workflow-chapter", String(index));
      expect(within(chapter).getByRole("heading", { name: en.landingExperience.story.steps[index].title })).toBeVisible();
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it("changes the accessible chapter on scroll without moving keyboard focus and restores all content in static mode", () => {
    const progress = motionValue(0);
    const renderAt = (activeStep: number, staticMode = false) => (
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkflowStory activeStep={activeStep} onStepChange={vi.fn()} progress={progress} staticMode={staticMode} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(renderAt(0));
    const stepButton = screen.getAllByRole("button")[0];
    stepButton.focus();
    act(() => progress.set(0.5));
    rerender(renderAt(1));
    expect(screen.getByRole("article", { name: en.landingExperience.story.steps[1].title })).toBeInTheDocument();
    expect(stepButton).toHaveFocus();
    rerender(renderAt(1, true));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByRole("article").every(chapter => !chapter.hasAttribute("inert"))).toBe(true);
    for (const chapter of screen.getAllByRole("article")) expect(chapter).toBeVisible();
    expect(stepButton).toHaveFocus();
  });

  it("settles on one fully readable chapter when scrolling stops between scene poses", async () => {
    const progress = motionValue(0);
    const renderAt = (activeStep: number) => (
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkflowStory activeStep={activeStep} onStepChange={vi.fn()} progress={progress} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(renderAt(0));
    act(() => progress.set(0.25));
    rerender(renderAt(1));
    // No more scroll updates: a stopped gesture must still finish the text
    // transition, even though the 3D objects remain between their two poses.
    await waitFor(() => {
      const chapters = screen.getAllByRole("article", { hidden: true });
      expect(chapters[0]).toHaveStyle({ opacity: 0 });
      expect(chapters[1]).toHaveStyle({ opacity: 1 });
      expect(chapters[2]).toHaveStyle({ opacity: 0 });
    });
  });
});
