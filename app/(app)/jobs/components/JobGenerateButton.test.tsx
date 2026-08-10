import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobGenerateButton } from "./JobGenerateButton";
import type { JobItem } from "../types";

const MESSAGES = {
  jobs: {
    generateThisJob: "AI Generate",
    generateQueueing: "Queueing...",
    generateRetry: "Try again",
    generateStalledHint: "stalled hint",
    tailoringQueued: "Queued",
    tailoringRunning: "Generating",
    tailoringStalled: "Stalled",
  },
};

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";

function renderButton(
  job: Partial<Pick<JobItem, "tailoringState" | "applicationId">>,
  pending = false,
) {
  const onGenerate = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <JobGenerateButton
        job={{ id: "job-1", applicationId: null, ...job }}
        pending={pending}
        onGenerate={onGenerate}
      />
    </NextIntlClientProvider>,
  );
  return { onGenerate, button: screen.queryByTestId("job-generate-button") };
}

afterEach(cleanup);

describe("JobGenerateButton", () => {
  it("offers generation for an untouched Job", () => {
    const { button } = renderButton({ tailoringState: "idle" });
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("AI Generate");
    expect(button).not.toBeDisabled();
  });

  it("disappears once the Job has an Application", () => {
    // The Saved CV/CL buttons sit beside this one. A second Generate there
    // would invite a run whose only effect is overwriting accepted work.
    const { button } = renderButton({
      tailoringState: "idle",
      applicationId: APPLICATION_ID,
    });
    expect(button).toBeNull();
  });

  it("blocks a duplicate request while the Job is queued", () => {
    const { button } = renderButton({ tailoringState: "queued" });
    expect(button).toBeDisabled();
    expect(button?.textContent).toContain("Queued");
  });

  it("blocks a duplicate request while the Job is running", () => {
    const { button } = renderButton({ tailoringState: "running" });
    expect(button).toBeDisabled();
    expect(button?.textContent).toContain("Generating");
  });

  it("explains a stall instead of offering a second identical request", () => {
    // Re-enqueueing a stalled Job is a no-op — its task still exists — so a
    // live button would produce a click that visibly does nothing.
    const { button } = renderButton({ tailoringState: "stalled" });
    expect(button).toBeDisabled();
    expect(button?.getAttribute("title")).toBe("stalled hint");
  });

  it("offers a retry after a failure", () => {
    const { button } = renderButton({ tailoringState: "failed" });
    expect(button).not.toBeDisabled();
    expect(button?.textContent).toContain("Try again");
  });

  it("stays generatable when a regenerate is in flight for a different Job", () => {
    const { button } = renderButton({ tailoringState: "idle" }, false);
    expect(button).not.toBeDisabled();
  });

  it("spins only for its own in-flight request", () => {
    const { button } = renderButton({ tailoringState: "idle" }, true);
    expect(button).toBeDisabled();
    expect(button?.getAttribute("aria-busy")).toBe("true");
  });
});
