import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResumeActionBar } from "./ResumeActionBar";

const resumeContextMock = vi.hoisted(() => ({
  value: {
    saving: false,
    handleSave: vi.fn(),
    setPreviewOpen: vi.fn(),
    hasAnyContent: true,
    schedulePreview: vi.fn(),
    isTaskHighlighted: vi.fn(() => false),
    t: (key: string) => key,
  },
}));

vi.mock("./ResumeContext", () => ({
  useResumeContext: () => resumeContextMock.value,
}));

describe("ResumeActionBar", () => {
  it("uses a wrapping mobile layout while preserving safe-area padding", () => {
    render(<ResumeActionBar />);

    const actionBar = screen.getByTestId("resume-action-bar");
    const row = actionBar.firstElementChild;
    const actions = row?.lastElementChild;

    expect(actionBar).toHaveStyle({
      paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)",
    });
    expect(row).toHaveClass("flex-wrap");
    expect(actions).toHaveClass("flex-wrap");
  });
});

