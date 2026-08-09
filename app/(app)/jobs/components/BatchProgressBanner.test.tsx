import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { BatchProgressBanner } from "./BatchProgressBanner";
import type { BatchProgressState } from "../hooks/useBatchProgress";

afterEach(cleanup);

const partialState: BatchProgressState = {
  batchId: "22222222-2222-2222-2222-222222222222",
  status: "PARTIAL",
  pending: 0,
  running: 0,
  succeeded: 2,
  failed: 1,
  skipped: 0,
  done: 3,
  total: 3,
  active: false,
  pollUnavailable: false,
  succeededItems: [],
  failedItems: [],
  failedJobIds: new Set(["job-failed"]),
};

describe("BatchProgressBanner", () => {
  it("keeps controls outside the live status message and marks partial completion as an issue", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BatchProgressBanner
          state={partialState}
          runnerStatus="online"
          onOpenSetup={vi.fn()}
          onViewDetails={vi.fn()}
          onDismiss={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    const liveMessage = screen.getByRole("status");
    expect(within(liveMessage).queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-triangle-alert")).not.toBeNull();
    expect(container.querySelector(".lucide-circle-check-big")).toBeNull();
  });
});
