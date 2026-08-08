import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

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


afterEach(cleanup);

describe("JobListItem", () => {
  it("renders the row without any fit badge, even when legacy fit data exists", () => {
    renderJobListItem({ fitEligibility: "PASS" });

    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
    // The fit-scoring surface was retired from the list: a stale score on an
    // old row must not resurface as an unexplained number chip.
    expect(screen.queryByText("82")).not.toBeInTheDocument();
    expect(screen.queryByText(/strong typescript alignment/i)).not.toBeInTheDocument();
  });

  it("renders localized status in Chinese without fit chrome", () => {
    renderJobListItem({ locale: "zh" });

    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
    expect(screen.queryByText("82")).not.toBeInTheDocument();
  });
});
