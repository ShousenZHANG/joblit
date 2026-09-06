import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { WorkflowStory } from "./WorkflowStory";

function renderStory(locale: "en" | "zh" = "en", onStepChange = vi.fn()) {
  function ControlledStory() {
    const [activeStep, setActiveStep] = useState(0);
    return <WorkflowStory activeStep={activeStep} onStepChange={(index) => { onStepChange(index); setActiveStep(index); }} />;
  }
  return { ...render(<NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><ControlledStory /></NextIntlClientProvider>), onStepChange };
}

describe("WorkflowStory", () => {
  afterEach(cleanup);

  it("keeps every step reachable while selecting one result and notifying the scene", async () => {
    const user = userEvent.setup();
    const { onStepChange } = renderStory();
    const steps = screen.getAllByRole("button");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByText("3+ years")).toBeVisible();

    await user.click(steps[1]);
    expect(onStepChange).toHaveBeenLastCalledWith(1);
    expect(steps[0]).toHaveAttribute("aria-expanded", "false");
    expect(steps[1]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByText("React")).toBeVisible();
    expect(document.getElementById(steps[1].getAttribute("aria-controls")!)).toHaveAttribute("aria-labelledby", steps[1].id);
    expect(steps[2]).toBeVisible();
  });

  it("supports native keyboard activation and exposes localized, labelled regions", async () => {
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
    expect(screen.getByText("Resume.pdf")).toBeVisible();
    expect(within(screen.getByRole("region")).getByText(zh.landingExperience.story.illustrative)).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });
});
