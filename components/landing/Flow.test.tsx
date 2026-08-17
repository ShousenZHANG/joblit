import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import en from "../../messages/en.json";
import { Flow } from "./Flow";

function renderFlow() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Flow />
    </NextIntlClientProvider>,
  );
}

describe("landing Flow", () => {
  afterEach(() => {
    cleanup();
  });

  it("draws the four stages in order, each with a real-UI miniature", () => {
    renderFlow();

    const list = screen.getByRole("list");
    const steps = within(list).getAllByRole("listitem");
    expect(steps).toHaveLength(4);

    const titles = steps.map(
      (step) => within(step).getByRole("heading", { level: 3 }).textContent,
    );
    expect(titles).toEqual([
      en.landing.flow.steps.fetch.title,
      en.landing.flow.steps.triage.title,
      en.landing.flow.steps.generate.title,
      en.landing.flow.steps.export.title,
    ]);

    // The miniatures are the section's licence to exist: real product
    // fragments, not icons. Pin one recognisable artifact per stage — the
    // tailor stage carries the real dialog's four phases (ADR-0022).
    expect(within(steps[1]).getByText("New")).toBeInTheDocument();
    expect(within(steps[2]).getByText("Copy prompt")).toBeInTheDocument();
    expect(within(steps[2]).getByText("Paste result")).toBeInTheDocument();
    expect(within(steps[2]).getByText("Review")).toBeInTheDocument();
    expect(within(steps[2]).getByText("Publish")).toBeInTheDocument();
    expect(within(steps[3]).getByText("CV — Acme.pdf")).toBeInTheDocument();
  });

  it("carries the id the nav's How-it-works anchor points at", () => {
    renderFlow();
    expect(screen.getByTestId("landing-flow")).toHaveAttribute("id", "flow");
  });

  it("never resurrects retired engines or features", () => {
    renderFlow();
    expect(screen.queryByText(/hermes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/fit score/i)).not.toBeInTheDocument();
    // The batch queue died with ADR-0022 — no generate button, no live count.
    expect(screen.queryByText("AI Generate")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ done/)).not.toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderFlow();
    expect(await axe(container)).toHaveNoViolations();
  });
});
