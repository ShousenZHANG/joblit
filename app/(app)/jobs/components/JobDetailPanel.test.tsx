import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMarket", () => ({ useMarket: () => "AU" }));

import { JobDetailPanel } from "./JobDetailPanel";
import type { JobItem, JobStatus } from "../types";
import messages from "@/messages/en.json";

function job(overrides: Partial<JobItem> = {}): JobItem {
  return {
    id: "job-1",
    title: "Platform Engineer",
    company: "Acme",
    location: "Sydney",
    jobUrl: "https://example.com/job-1",
    status: "NEW",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as JobItem;
}

function renderPanel(selectedJob: JobItem) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <JobDetailPanel
        selectedJob={selectedJob}
        selectedDescription=""
        selectedFitMatrix={null}
        detailError={null}
        detailLoading={false}
        showLoadingOverlay={false}
        updatingIds={new Set()}
        deletingIds={new Set()}
        highlightGenerate={false}
        guideHighlightClass=""
        externalPromptLoading={false}
        mobileTab="detail"
        onUpdateStatus={vi.fn()}
        onDelete={vi.fn()}
        onGenerateResume={vi.fn()}
        onGenerateCover={vi.fn()}
        onRetryDetail={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("JobDetailPanel status presentation", () => {
  it("shows the active statuses with their own labels", () => {
    renderPanel(job({ status: "APPLIED" }));
    expect(screen.getAllByText(messages.jobs.statusApplied).length).toBeGreaterThan(0);
  });

  // ADR-0007 retired INTERVIEW, OFFER, ACCEPTED and WITHDRAWN but kept them
  // parseable, so a row the migration missed still reaches this panel. The
  // badge colour has always gone through jobStatusPresentation, which applies
  // the projection. The label did not: it read a local seven-entry map, so the
  // badge rendered "Interview" text on the APPLIED colour, and the status
  // Select displayed a value that is not among its own options.
  const retired: Array<[JobStatus, keyof typeof messages.jobs]> = [
    ["INTERVIEW", "statusApplied"],
    ["OFFER", "statusApplied"],
    ["ACCEPTED", "statusApplied"],
    ["WITHDRAWN", "statusRejected"],
  ];

  it.each(retired)(
    "projects a retired %s status onto its active label",
    (status, expectedKey) => {
      renderPanel(job({ status }));

      const expected = messages.jobs[expectedKey] as string;
      expect(screen.getAllByText(expected).length).toBeGreaterThan(0);

      // The retired label must not appear anywhere in the panel.
      const retiredLabel = messages.jobs[
        `status${status.charAt(0)}${status.slice(1).toLowerCase()}` as keyof typeof messages.jobs
      ] as string;
      expect(screen.queryByText(retiredLabel)).not.toBeInTheDocument();
    },
  );
});
