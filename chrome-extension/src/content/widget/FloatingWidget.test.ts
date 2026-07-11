import { describe, expect, it, vi } from "vitest";
import { FloatingWidget } from "./FloatingWidget";

describe("FloatingWidget announcements", () => {
  it("announces submission-recording failures assertively", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const widget = new FloatingWidget(container, {
      onRecordSubmission: vi.fn(),
      onCorrectMapping: vi.fn(),
      onSaveRule: vi.fn().mockResolvedValue(true),
      onApplyValue: vi.fn(),
    });

    widget.showSubmissionError();

    const toast = container.querySelector(".jf-toast");
    expect(toast?.getAttribute("role")).toBe("alert");
    expect(toast?.getAttribute("aria-live")).toBe("assertive");

    widget.destroy();
    container.remove();
  });
});
