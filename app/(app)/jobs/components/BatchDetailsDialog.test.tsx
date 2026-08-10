import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { BatchDetailsDialog } from "./BatchDetailsDialog";
import type { BatchProgressState } from "../hooks/useBatchProgress";

afterEach(cleanup);

const state: BatchProgressState = {
  batchId: "22222222-2222-2222-2222-222222222222",
  status: "PARTIAL",
  pending: 0,
  running: 0,
  succeeded: 1,
  failed: 1,
  skipped: 1,
  done: 3,
  total: 3,
  active: false,
  pollUnavailable: false,
  failedJobIds: new Set(["job-failed"]),
  failedItems: [
    {
      taskId: "task-failed",
      applicationId: "55555555-5555-4555-8555-555555555555",
      jobId: "job-failed",
      jobTitle: "Backend Engineer",
      company: "Beta",
      attempt: 1,
      error: "MODEL_OUTPUT_INVALID",
      updatedAt: "2026-08-09T00:00:00.000Z",
      artifacts: {
        resumePdfUrl: null,
        coverPdfUrl: null,
      },
    },
  ],
  succeededItems: [
    {
      taskId: "task-success",
      applicationId: "66666666-6666-4666-8666-666666666666",
      jobId: "job-success",
      jobTitle: "Frontend Engineer",
      company: "Acme",
      completedAt: "2026-08-09T00:00:00.000Z",
      artifacts: {
        resumePdfUrl: "https://example.com/cv.pdf",
        coverPdfUrl: "https://example.com/cl.pdf",
      },
    },
  ],
};

describe("BatchDetailsDialog", () => {
  it("exposes artifacts and failed-task recovery from a partial batch", async () => {
    const user = userEvent.setup();
    const onRetryFailed = vi.fn();
    const onReview = vi.fn().mockResolvedValue(true);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BatchDetailsDialog
          open
          onOpenChange={vi.fn()}
          state={state}
          actionPending={false}
          onCancel={vi.fn()}
          onRetryFailed={onRetryFailed}
          reviewLoading={null}
          reviewError={null}
          onReview={onReview}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Batch details" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("MODEL_OUTPUT_INVALID")).toBeInTheDocument();
    const cvButtons = screen.getAllByRole("button", {
      name: "Review and edit CV",
    });
    const coverButtons = screen.getAllByRole("button", {
      name: "Review and edit cover letter",
    });
    expect(cvButtons).toHaveLength(2);
    expect(coverButtons).toHaveLength(2);
    await user.click(cvButtons[0]);
    expect(onReview).toHaveBeenCalledWith(
      "55555555-5555-4555-8555-555555555555",
      "job-failed",
      "resume",
    );
    expect(
      screen.queryByRole("button", { name: "Stop remaining" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry 1 failed" }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });

  it("announces a targeted review load without disabling unrelated documents", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BatchDetailsDialog
          open
          onOpenChange={vi.fn()}
          state={state}
          actionPending={false}
          onCancel={vi.fn()}
          onRetryFailed={vi.fn()}
          reviewLoading={{
            applicationId: "66666666-6666-4666-8666-666666666666",
            jobId: "job-success",
            target: "cover",
          }}
          reviewError="Generation is still settling."
          onReview={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Generation is still settling.",
    );
    expect(
      screen.getAllByRole("button", { name: "Opening cover letter editor" })[0],
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getAllByRole("button", { name: "Review and edit CV" })[1],
    ).not.toBeDisabled();
  });

  it("keeps legacy batch PDFs as external downloads without exposing Review actions", () => {
    const legacyState: BatchProgressState = {
      ...state,
      status: "SUCCEEDED",
      failed: 0,
      failedItems: [],
      succeeded: 1,
      skipped: 0,
      done: 1,
      total: 1,
      succeededItems: [
        {
          ...state.succeededItems[0],
          applicationId: null,
          artifacts: {
            resumePdfUrl: "https://example.com/legacy-cv.pdf",
            coverPdfUrl: "https://example.com/legacy-cl.pdf",
          },
        },
      ],
    };

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BatchDetailsDialog
          open
          onOpenChange={vi.fn()}
          state={legacyState}
          actionPending={false}
          onCancel={vi.fn()}
          onRetryFailed={vi.fn()}
          reviewLoading={null}
          reviewError={null}
          onReview={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.queryByRole("button", { name: "Review and edit CV" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open CV PDF" })).toHaveAttribute(
      "href",
      "https://example.com/legacy-cv.pdf",
    );
    expect(
      screen.getByRole("link", { name: "Open cover letter PDF" }),
    ).toHaveAttribute("href", "https://example.com/legacy-cl.pdf");
  });
});
