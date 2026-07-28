import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DocumentWorkbench,
  type DocumentWorkbenchPane,
} from "./DocumentWorkbench";

const labels = {
  tablist: "Document view",
  editor: "Edit",
  preview: "Preview",
};

function mockDesktopViewport(matches: boolean) {
  vi.spyOn(window, "matchMedia");
  setDesktopViewport(matches);
}

function setDesktopViewport(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query === "(min-width: 1024px)" && matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
}

function ControlledWorkbench({
  initialPane = "editor",
}: {
  initialPane?: DocumentWorkbenchPane;
}) {
  const [pane, setPane] = useState<DocumentWorkbenchPane>(initialPane);

  return (
    <DocumentWorkbench
      pane={pane}
      onPaneChange={setPane}
      labels={labels}
      editor={<div>Editor content</div>}
      preview={<div>Preview content</div>}
    />
  );
}

describe("DocumentWorkbench", () => {
  beforeEach(() => mockDesktopViewport(false));

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("switches the active mobile pane through its controlled render seam", () => {
    render(<ControlledWorkbench />);

    const editorTab = screen.getByRole("tab", { name: "Edit" });
    const previewTab = screen.getByRole("tab", { name: "Preview" });
    const editorPanel = screen.getByRole("tabpanel", { name: "Edit" });
    const previewPanel = screen.getByRole("tabpanel", { name: "Preview" });

    expect(screen.getByRole("tablist", { name: "Document view" })).toHaveClass(
      "lg:hidden",
    );
    expect(editorTab).toHaveAttribute("aria-selected", "true");
    expect(previewTab).toHaveAttribute("aria-selected", "false");
    expect(editorPanel).not.toHaveClass("hidden");
    expect(previewPanel).toHaveClass("hidden", "lg:block");

    fireEvent.click(previewTab);

    expect(editorTab).toHaveAttribute("aria-selected", "false");
    expect(previewTab).toHaveAttribute("aria-selected", "true");
    expect(editorPanel).toHaveClass("hidden", "lg:block");
    expect(previewPanel).not.toHaveClass("hidden");
  });

  it("moves selection and focus with the standard horizontal-tab keys", () => {
    render(<ControlledWorkbench />);

    const editorTab = screen.getByRole("tab", { name: "Edit" });
    const previewTab = screen.getByRole("tab", { name: "Preview" });
    editorTab.focus();

    fireEvent.keyDown(editorTab, { key: "ArrowRight" });

    expect(previewTab).toHaveAttribute("aria-selected", "true");
    expect(previewTab).toHaveFocus();

    fireEvent.keyDown(previewTab, { key: "Home" });

    expect(editorTab).toHaveAttribute("aria-selected", "true");
    expect(editorTab).toHaveFocus();
  });

  it("exposes desktop split panes as named regions without tab semantics", () => {
    setDesktopViewport(true);

    render(<ControlledWorkbench />);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("tabpanel")).toHaveLength(0);
    const editorRegion = screen.getByRole("region", { name: "Edit" });
    expect(editorRegion).toHaveTextContent(
      "Editor content",
    );
    expect(screen.getByRole("region", { name: "Preview" })).toHaveTextContent(
      "Preview content",
    );
    expect(editorRegion.parentElement).toHaveClass(
      "grid-cols-1",
      "lg:grid-cols-[var(--document-workbench-columns)]",
    );
  });

  it("keeps the server snapshot compact and CSS-ready for desktop", () => {
    setDesktopViewport(true);

    const html = renderToString(<ControlledWorkbench />);

    expect(html).toContain('role="tablist"');
    expect(html).toContain("lg:hidden");
    expect(html).toContain(
      "lg:grid-cols-[var(--document-workbench-columns)]",
    );
    expect(html).not.toContain('role="region"');
  });

  it("keeps localization and layout customization at the public interface", () => {
    const { container } = render(
      <DocumentWorkbench
        pane="preview"
        onPaneChange={() => {}}
        labels={{
          tablist: "文档视图",
          editor: "编辑",
          preview: "预览",
        }}
        editor={<div>编辑内容</div>}
        preview={<div>预览内容</div>}
        className="h-full"
        columns="minmax(0, 2fr) minmax(20rem, 1fr)"
      />,
    );

    const root = container.querySelector<HTMLElement>(
      '[data-slot="document-workbench"]',
    );
    const editorTab = screen.getByRole("tab", { name: "编辑" });
    const previewTab = screen.getByRole("tab", { name: "预览" });
    const editorPanel = screen.getByRole("tabpanel", { name: "编辑" });
    const previewPanel = screen.getByRole("tabpanel", { name: "预览" });

    expect(root).not.toBeNull();
    expect(root).toHaveClass(
      "h-full",
      "pb-[max(0px,env(safe-area-inset-bottom))]",
    );
    expect(root?.style.getPropertyValue("--document-workbench-columns")).toBe(
      "minmax(0, 2fr) minmax(20rem, 1fr)",
    );
    expect(editorTab).toHaveAttribute("aria-controls", editorPanel.id);
    expect(previewTab).toHaveAttribute("aria-controls", previewPanel.id);
    expect(editorTab).toHaveClass(
      "min-h-11",
      "touch-manipulation",
      "motion-reduce:transition-none",
    );
  });

  it("has no detectable accessibility violations at the render seam", async () => {
    const { container } = render(<ControlledWorkbench />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no detectable accessibility violations in desktop split mode", async () => {
    setDesktopViewport(true);
    const { container } = render(<ControlledWorkbench />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
