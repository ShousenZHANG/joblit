import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import type { JobExperienceAnalysis } from "@/lib/shared/jobExperienceAnalysis";
import messages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import { ExperienceRequirementSummary } from "./ExperienceRequirementSummary";

afterEach(cleanup);

const analysis: JobExperienceAnalysis = {
  schemaVersion: 1,
  status: "REVIEW",
  requirements: [
    {
      id: "backend-required",
      classification: "REQUIRED",
      years: { operator: "MINIMUM", min: 3, max: null, text: "3+ years" },
      scope: "backend engineering",
      evidence: {
        text: "At least 3+ years of backend engineering experience is required.",
        start: 0,
        end: 65,
        yearsStart: 9,
        yearsEnd: 17,
      },
      relation: { groupId: "backend-or-platform", kind: "ANY_OF" },
    },
    {
      id: "platform-required",
      classification: "REQUIRED",
      years: { operator: "MINIMUM", min: 2, max: null, text: "2+ years" },
      scope: "platform engineering",
      evidence: {
        text: "Or 2+ years working on production platforms.",
        start: 66,
        end: 110,
        yearsStart: 69,
        yearsEnd: 77,
      },
      relation: { groupId: "backend-or-platform", kind: "ANY_OF" },
    },
    {
      id: "cloud-preferred",
      classification: "PREFERRED",
      years: { operator: "MINIMUM", min: 1, max: null, text: "1+ years" },
      scope: "cloud operations",
      evidence: {
        text: "One year of cloud operations experience is preferred.",
        start: 111,
        end: 164,
        yearsStart: 111,
        yearsEnd: 119,
      },
    },
    {
      id: "leadership-review",
      classification: "REVIEW",
      years: { operator: "RANGE", min: 2, max: 4, text: "2-4 years" },
      scope: "leadership",
      evidence: {
        text: "The wording mentions 2-4 years of leadership experience.",
        start: 165,
        end: 221,
        yearsStart: 186,
        yearsEnd: 195,
      },
    },
  ],
};

function renderSummary(value: JobExperienceAnalysis | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ExperienceRequirementSummary analysis={value} />
    </NextIntlClientProvider>,
  );
}

describe("ExperienceRequirementSummary", () => {
  it("separates classifications and makes alternatives explicit without destructive styling", () => {
    renderSummary(analysis);

    const summary = screen.getByTestId("experience-requirement-summary");
    expect(
      within(summary).getByRole("heading", { name: "Experience requirement" }),
    ).toBeInTheDocument();
    expect(within(summary).getAllByText("Required")).toHaveLength(2);
    expect(within(summary).getByText("Preferred")).toBeInTheDocument();
    expect(within(summary).getByText("Needs review")).toBeInTheDocument();
    const reviewCard = summary.querySelector<HTMLElement>(
      "[data-classification='REVIEW']",
    );
    expect(reviewCard).not.toBeNull();
    if (reviewCard) {
      expect(
        within(reviewCard).getByText("Possible experience wording"),
      ).toBeInTheDocument();
      expect(
        within(reviewCard).queryByText("2-4 years", { selector: "strong" }),
      ).toBeNull();
    }
    expect(within(summary).getByText("OR")).toBeInTheDocument();
    expect(
      within(summary).getByRole("group", { name: "Any one of these requirements" }),
    ).toBeInTheDocument();
    expect(summary.querySelector(".border-rose-300")).toBeNull();
    expect(summary.querySelector(".bg-rose-50")).toBeNull();
    expect(
      summary.querySelector<HTMLElement>(
        "[data-classification='REQUIRED'] > div",
      ),
    ).toHaveClass("flex-col", "sm:flex-row");
  });

  it("labels requirements that must all be met with an accessible AND group", () => {
    const allOf: JobExperienceAnalysis = {
      ...analysis,
      requirements: analysis.requirements.slice(0, 2).map((requirement) => ({
        ...requirement,
        relation: { groupId: "combined-experience", kind: "ALL_OF" as const },
      })),
    };
    renderSummary(allOf);

    expect(screen.getByText("AND")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "All of these requirements" }),
    ).toBeInTheDocument();
  });

  it("exposes the exact JD evidence through a keyboard-sized native disclosure", async () => {
    const user = userEvent.setup();
    renderSummary(analysis);

    const disclosure = screen.getAllByText("View JD evidence")[0].closest("summary");
    expect(disclosure).toHaveClass("min-h-11");
    expect(disclosure).not.toBeNull();
    if (!disclosure) return;

    await user.click(disclosure);
    expect(
      screen.getByText("At least 3+ years of backend engineering experience is required."),
    ).toBeVisible();
  });

  it("renders nothing when the analysis has no trusted requirement", () => {
    const { container } = renderSummary({
      schemaVersion: 1,
      status: "NONE",
      requirements: [],
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("warns when the bounded contract could not include every match", () => {
    renderSummary({
      schemaVersion: 1,
      status: "REVIEW",
      requirements: [],
      truncated: true,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "This JD contains more experience wording than can be shown here.",
    );
  });

  it("localizes the visible classification and evidence controls", () => {
    render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <ExperienceRequirementSummary
          analysis={{ ...analysis, requirements: [analysis.requirements[0]] }}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "职位经验要求" }),
    ).toBeInTheDocument();
    expect(screen.getByText("必须")).toBeInTheDocument();
    expect(screen.getByText("查看 JD 原文证据")).toBeInTheDocument();
  });
});
