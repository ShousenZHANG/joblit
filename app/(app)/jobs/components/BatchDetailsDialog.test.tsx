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
      jobId: "job-failed",
      jobTitle: "Backend Engineer",
      company: "Beta",
      attempt: 1,
      error: "MODEL_OUTPUT_INVALID",
      updatedAt: "2026-08-09T00:00:00.000Z",
    },
  ],
  succeededItems: [
    {
      taskId: "task-success",
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
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BatchDetailsDialog
          open
          onOpenChange={vi.fn()}
          state={state}
          actionPending={false}
          onCancel={vi.fn()}
          onRetryFailed={onRetryFailed}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Batch details" })).toBeInTheDocument();
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("MODEL_OUTPUT_INVALID")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review CV" })).toHaveAttribute(
      "href",
      "https://example.com/cv.pdf",
    );
    expect(screen.getByRole("link", { name: "Review cover letter" })).toHaveAttribute(
      "href",
      "https://example.com/cl.pdf",
    );
    expect(screen.queryByRole("button", { name: "Stop remaining" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry 1 failed" }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });
});
