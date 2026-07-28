import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import type { JobItem } from "../types";
import { JobListItem } from "./JobListItem";

function fitScoredJob(
  fitEligibility?: "PASS" | "RISK" | "BLOCK",
): JobItem {
  return {
    id: "job-fit",
    title: "Platform Engineer",
    company: "Acme",
    location: "Sydney",
    jobUrl: "https://example.com/job-fit",
    status: "NEW",
    fitScore: 82,
    fitVerdict: "Strong TypeScript alignment",
    fitEligibility,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  } as JobItem;
}

function renderJobListItem({
  locale = "en",
  fitEligibility,
}: {
  locale?: "en" | "zh";
  fitEligibility?: "PASS" | "RISK" | "BLOCK";
} = {}) {
  const messages = locale === "zh" ? zhMessages : enMessages;

  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      now={new Date("2026-07-28T00:00:00.000Z")}
    >
      <JobListItem
        job={fitScoredJob(fitEligibility)}
        isActive
        onSelect={vi.fn()}
        timeZone="Australia/Sydney"
      />
    </NextIntlClientProvider>,
  );
}

describe("JobListItem fit explanation", () => {
  it("exposes the fit verdict as accessible text instead of title-only help", () => {
    const view = renderJobListItem();

    expect(
      screen.getByText("Fit score 82. Strong TypeScript alignment"),
    ).toHaveClass("sr-only");
    expect(view.container.querySelector('[data-job-id="job-fit"]')).toHaveClass(
      "[@media(any-pointer:coarse)]:min-h-11",
    );
  });

  it.each([
    ["PASS", "Eligibility check passed."],
    ["RISK", "Eligibility needs review."],
    ["BLOCK", "Eligibility requirements are not met."],
  ] as const)(
    "announces the localized %s eligibility conclusion in English",
    (fitEligibility, conclusion) => {
      renderJobListItem({ fitEligibility });

      expect(
        screen.getByText(
          `${conclusion} Fit score 82. Strong TypeScript alignment`,
        ),
      ).toHaveClass("sr-only");
    },
  );

  it.each([
    ["PASS", "资格检查通过。"],
    ["RISK", "资格检查需要人工确认。"],
    ["BLOCK", "资格检查未通过。"],
  ] as const)(
    "announces the localized %s eligibility conclusion in Chinese",
    (fitEligibility, conclusion) => {
      renderJobListItem({ locale: "zh", fitEligibility });

      expect(
        screen.getByText(
          `${conclusion} 匹配分数 82。Strong TypeScript alignment`,
        ),
      ).toHaveClass("sr-only");
    },
  );
});
