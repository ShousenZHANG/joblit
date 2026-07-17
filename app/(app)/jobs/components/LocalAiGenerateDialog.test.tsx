import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";
import { LocalAiGenerateDialog } from "./LocalAiGenerateDialog";
import type { LocalAiRunState } from "../hooks/useLocalAiRun";

const job = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  title: "Platform Engineer",
  company: "Example Co",
  target: "resume" as const,
};

function renderDialog(runState: LocalAiRunState = { status: "idle" }, overrides = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    availability: "ready" as const,
    runState,
    job,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onCheckAgain: vi.fn(),
    onUseManual: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LocalAiGenerateDialog {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("LocalAiGenerateDialog", () => {
  it("starts directly from one primary action and exposes polite status", async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByRole("button", { name: "Generate with Local AI" }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Local AI is ready").closest("[aria-live='polite']")).toBeTruthy();
  });

  it.each([
    ["starting", "Starting securely…"],
    ["queued", "Queued on your computer"],
    ["running", "Hermes is tailoring your document"],
    ["importing", "Importing a strict draft…"],
  ] as const)("renders %s stage", (status, label) => {
    renderDialog({ status, requestId: job.id, jobId: job.id, target: "resume" } as LocalAiRunState);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("stops a running task", async () => {
    const user = userEvent.setup();
    const props = renderDialog({ status: "running", requestId: job.id, jobId: job.id, target: "resume" });
    await user.click(screen.getByRole("button", { name: "Stop local run" }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("shows stable retryable errors and retry", async () => {
    const user = userEvent.setup();
    const props = renderDialog({
      status: "failed",
      error: { code: "RUN_LOST", retryable: true },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("The local run can no longer be found");
    await user.click(screen.getByRole("button", { name: "Start new run" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("guards close while importing", () => {
    const props = renderDialog({ status: "importing", requestId: job.id, jobId: job.id, target: "resume" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the manual method available as fallback", async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByRole("button", { name: "Use manual method" }));
    expect(props.onUseManual).toHaveBeenCalledTimes(1);
  });
});
