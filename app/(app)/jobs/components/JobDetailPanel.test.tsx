import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMarket", () => ({ useMarket: () => "AU" }));

import { JobDetailPanel } from "./JobDetailPanel";
import type { JobItem, JobStatus } from "../types";
import type { JobExperienceAnalysis } from "@/lib/shared/jobExperienceAnalysis";
import messages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

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

function renderPanel(
  selectedJob: JobItem,
  options: {
    selectedDescription?: string;
    experienceAnalysis?: JobExperienceAnalysis | null;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <JobDetailPanel
        selectedJob={selectedJob}
        selectedDescription={options.selectedDescription ?? ""}
        experienceAnalysis={options.experienceAnalysis}
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
        onManualGenerate={vi.fn()}
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

describe("JobDetailPanel localization", () => {
  it("renders the description and tailoring-source copy in the active locale", () => {
    render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <JobDetailPanel
          selectedJob={job({ listingDate: "2026-07-01T00:00:00.000Z" })}
          selectedDescription=""
          selectedFitMatrix={null}
          detailError={null}
          detailLoading={false}
          showLoadingOverlay={false}
          tailorSource={{ cv: "manual_import", cover: "fallback" }}
          updatingIds={new Set()}
          deletingIds={new Set()}
          highlightGenerate={false}
          guideHighlightClass=""
          externalPromptLoading={false}
          mobileTab="detail"
          onUpdateStatus={vi.fn()}
          onDelete={vi.fn()}
          onManualGenerate={vi.fn()}
          onRetryDetail={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("职位描述")).toBeInTheDocument();
    expect(screen.getByText("该职位暂时没有可用的职位描述。")).toBeInTheDocument();
    expect(screen.getByText("简历来源：手动导入")).toBeInTheDocument();
    expect(screen.getByText("求职信来源：回退版本")).toBeInTheDocument();
    expect(screen.getByText(/^发布于/)).toBeInTheDocument();
  });
});

describe("JobDetailPanel touch contract", () => {
  it("keeps compact primary actions touch-sized on coarse pointers", () => {
    const view = renderPanel(job({ status: "APPLIED" }));
    const panel = within(view.container);

    expect(panel.getByRole("combobox")).toHaveClass(
      "[@media(any-pointer:coarse)]:min-h-11",
    );
    expect(
      panel.getByRole("link", { name: messages.jobs.openJob }),
    ).toHaveClass("[@media(any-pointer:coarse)]:min-h-11");
    // Remove is a menu item behind the overflow now, so the trigger is what
    // has to stay thumb-sized; the item itself gets min-h-11 from the menu.
    expect(panel.getByTestId("job-detail-overflow")).toHaveClass(
      "[@media(any-pointer:coarse)]:min-h-11",
    );
  });
});

describe("JobDetailPanel experience summary", () => {
  it(
    "renders the JD-derived requirement in the merged panel and passes it to the description",
    async () => {
      const description =
        "Requirements: At least 4 years of platform engineering experience.";
      const yearsText = "At least 4 years";
      const yearsStart = description.indexOf(yearsText);
      const experienceAnalysis: JobExperienceAnalysis = {
        schemaVersion: 2,
        status: "FOUND",
        requirements: [
          {
            id: "platform-years",
            classification: "REQUIRED",
            years: {
              operator: "MINIMUM",
              min: 4,
              max: null,
              text: yearsText,
            },
            scope: "platform engineering",
            evidence: {
              text: description,
              start: 0,
              end: description.length,
              yearsStart,
              yearsEnd: yearsStart + yearsText.length,
            },
          },
        ],
      };

      const view = renderPanel(job({ fitScore: 72, fitVerdict: "GOOD" }), {
        selectedDescription: description,
        experienceAnalysis,
      });

      const panel = screen.getByTestId("jd-requirements-panel");
      expect(panel).toHaveTextContent("At least 4 years");

      const highlighted = await within(view.container).findByLabelText(
        "Required: At least 4 years",
        {},
        { timeout: 5_000 },
      );
      expect(highlighted).toHaveAttribute(
        "data-experience-highlight",
        "REQUIRED",
      );
    },
    10_000,
  );
});
