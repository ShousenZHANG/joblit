import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    onTailor?: (job: JobItem, target: "resume" | "cover") => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <JobDetailPanel
        selectedJob={selectedJob}
        selectedDescription={options.selectedDescription ?? ""}
        experienceAnalysis={options.experienceAnalysis}
        detailError={null}
        detailLoading={false}
        showLoadingOverlay={false}
        updatingIds={new Set()}
        deletingIds={new Set()}
        mobileTab="detail"
        onUpdateStatus={vi.fn()}
        onDelete={vi.fn()}
        onTailor={options.onTailor ?? vi.fn()}
        onRetryDetail={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("JobDetailPanel status presentation", () => {
  it("shows the active statuses with their own labels", () => {
    renderPanel(job({ status: "APPLIED" }));
    expect(
      screen.getAllByText(messages.jobs.statusApplied).length,
    ).toBeGreaterThan(0);
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
          detailError={null}
          detailLoading={false}
          showLoadingOverlay={false}
          tailorSource={{ cv: "manual_import", cover: "fallback" }}
          updatingIds={new Set()}
          deletingIds={new Set()}
          mobileTab="detail"
          onUpdateStatus={vi.fn()}
          onDelete={vi.fn()}
          onTailor={vi.fn()}
          onRetryDetail={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("职位描述")).toBeInTheDocument();
    expect(
      screen.getByText("该职位暂时没有可用的职位描述。"),
    ).toBeInTheDocument();
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

describe("JobDetailPanel saved document review", () => {
  it("opens an owned saved document in the tailoring dialog", async () => {
    const user = userEvent.setup();
    const onTailor = vi.fn();
    const selected = job({
      applicationId: "11111111-1111-4111-8111-111111111111",
      resumePdfUrl: "https://example.com/stored-cv.pdf",
    });
    renderPanel(selected, { onTailor });

    const savedCv = screen.getByRole("button", { name: messages.jobs.savedCv });
    expect(
      screen.queryByRole("link", { name: messages.jobs.savedCv }),
    ).not.toBeInTheDocument();
    await user.click(savedCv);
    expect(onTailor).toHaveBeenCalledWith(selected, "resume");
  });

  it("offers one Tailor entry in the overflow menu", async () => {
    const user = userEvent.setup();
    const onTailor = vi.fn();
    const selected = job();
    const view = renderPanel(selected, { onTailor });

    await user.click(within(view.container).getByTestId("job-detail-overflow"));
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(1);
    await user.click(items[0]);
    expect(items[0]).toHaveTextContent(messages.jobs.tailorAction);
    expect(onTailor).toHaveBeenCalledWith(selected, "resume");
  });

  it("keeps the PDF link for a legacy row without an Application identity", () => {
    renderPanel(
      job({
        applicationId: null,
        resumePdfUrl: "https://example.com/legacy-cv.pdf",
      }),
    );

    expect(
      screen.getByRole("link", { name: messages.jobs.savedCv }),
    ).toHaveAttribute("href", "https://example.com/legacy-cv.pdf");
  });
});

describe("JobDetailPanel delete focus", () => {
  it("hands focus to the replacement job heading after deleting with the keyboard", async () => {
    const first = job();
    const replacement = job({ id: "job-2", title: "Backend Engineer" });

    function Harness() {
      const [selected, setSelected] = useState(first);
      return (
        <NextIntlClientProvider locale="en" messages={messages}>
          <JobDetailPanel
            selectedJob={selected}
            selectedDescription=""
            detailError={null}
            detailLoading={false}
            showLoadingOverlay={false}
            updatingIds={new Set()}
            deletingIds={new Set()}
            mobileTab="detail"
            onUpdateStatus={vi.fn()}
            onDelete={() => setSelected(replacement)}
            onTailor={vi.fn()}
            onRetryDetail={vi.fn()}
          />
        </NextIntlClientProvider>
      );
    }

    const user = userEvent.setup();
    const view = render(<Harness />);
    await user.click(
      within(view.container).getByRole("button", {
        name: messages.jobs.remove,
      }),
    );

    expect(
      await within(view.container).findByRole("heading", {
        name: "Backend Engineer",
      }),
    ).toHaveFocus();
  });
});

describe("JobDetailPanel experience summary", () => {
  it("renders the JD-derived requirement in the merged panel and passes it to the description", async () => {
    const description =
      "Requirements: At least 4 years of platform engineering experience.";
    const yearsText = "At least 4 years";
    const yearsStart = description.indexOf(yearsText);
    const experienceAnalysis: JobExperienceAnalysis = {
      schemaVersion: 3,
      status: "FOUND",
      requirements: [
        {
          id: "platform-years",
          classification: "REQUIRED",
          years: {
            operator: "AT_LEAST",
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

    const view = renderPanel(job(), {
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
  }, 10_000);
});
