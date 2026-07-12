import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useKeyboardNavigation } from "./useKeyboardNavigation";

const items = [{ id: "first" }, { id: "second" }];
const externallySelectedItems = [...items, { id: "third" }];

function JobsKeyboardHarness({
  initialSelectedId = "first",
  onSelect,
}: {
  initialSelectedId?: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleSelect = useCallback(
    (id: string | null) => {
      onSelect(id);
      setSelectedId(id);
    },
    [onSelect],
  );

  useKeyboardNavigation({
    containerRef,
    items,
    selectedId,
    onSelect: handleSelect,
  });

  return (
    <>
      <button type="button">Outside control</button>
      <div
        ref={containerRef}
        data-testid="jobs-list"
        tabIndex={selectedId === null ? 0 : -1}
      >
        <button
          type="button"
          data-job-id="first"
          tabIndex={selectedId === "first" ? 0 : -1}
          aria-current={selectedId === "first" ? "true" : undefined}
        >
          First role
        </button>
        <div data-job-id="nested-row">
          <button type="button" data-testid="nested-button">Nested action</button>
          <input aria-label="Nested input" />
          <textarea aria-label="Nested textarea" />
          <select aria-label="Nested select" defaultValue="one">
            <option value="one">One</option>
            <option value="two">Two</option>
          </select>
          <a href="/jobs/example">Nested link</a>
          <div contentEditable suppressContentEditableWarning tabIndex={0}>
            Editable content
          </div>
          <div data-testid="empty-contenteditable" tabIndex={0}>Empty editable</div>
          <div data-testid="plaintext-contenteditable" tabIndex={0}>Plaintext editable</div>
          <div role="dialog" aria-label="Nested dialog" tabIndex={0} />
          <div role="menu" aria-label="Nested menu" tabIndex={0} />
          <div role="listbox" aria-label="Nested listbox" tabIndex={0} />
          <div
            role="combobox"
            aria-label="Nested combobox"
            aria-controls="nested-combobox-options"
            aria-expanded="false"
            tabIndex={0}
          />
        </div>
        <span data-testid="list-background" tabIndex={0}>List background</span>
        <button
          type="button"
          data-job-id="second"
          tabIndex={selectedId === "second" ? 0 : -1}
          aria-current={selectedId === "second" ? "true" : undefined}
        >
          Second role
        </button>
      </div>
    </>
  );
}

function MissingTargetHarness({ prepareRowFocus }: { prepareRowFocus: (index: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useKeyboardNavigation({
    containerRef,
    items,
    selectedId: "first",
    onSelect: () => {},
    prepareRowFocus,
  });

  return (
    <div ref={containerRef} data-testid="missing-target-list">
      <button type="button" data-job-id="first">First role</button>
    </div>
  );
}

function ExternalSelectionHarness({
  selectedId,
  renderPendingTarget,
  onSelect,
  prepareRowFocus,
}: {
  selectedId: string;
  renderPendingTarget: boolean;
  onSelect: (id: string | null) => void;
  prepareRowFocus: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useKeyboardNavigation({
    containerRef,
    items: externallySelectedItems,
    selectedId,
    onSelect,
    prepareRowFocus,
  });

  return (
    <div ref={containerRef} data-testid="external-selection-list">
      <button type="button" data-job-id="first">First role</button>
      {renderPendingTarget ? (
        <button type="button" data-job-id="second">Second role</button>
      ) : null}
      <button type="button" data-job-id="third">Third role</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useKeyboardNavigation", () => {
  it.each([
    { selector: "[data-testid='nested-button']" },
    { selector: "input" },
    { selector: "textarea" },
    { selector: "select" },
    { selector: "a[href]" },
    { selector: "[contenteditable='true']" },
    { selector: "[data-testid='empty-contenteditable']", contentEditable: "" },
    { selector: "[data-testid='plaintext-contenteditable']", contentEditable: "plaintext-only" },
    { selector: "[role='dialog']" },
    { selector: "[role='menu']" },
    { selector: "[role='listbox']" },
    { selector: "[role='combobox']" },
  ])("does not intercept nested $selector keyboard behavior", ({ selector, contentEditable }) => {
    const onSelect = vi.fn();
    render(<JobsKeyboardHarness onSelect={onSelect} />);
    const list = screen.getByTestId("jobs-list");
    const target = list.querySelector<HTMLElement>(selector);
    expect(target).not.toBeNull();
    if (contentEditable !== undefined) {
      target!.setAttribute("contenteditable", contentEditable);
    }

    target!.focus();
    const wasNotCancelled = fireEvent.keyDown(target!, { key: "ArrowDown" });

    expect(wasNotCancelled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not intercept keyboard events from the list background", () => {
    const onSelect = vi.fn();
    render(<JobsKeyboardHarness onSelect={onSelect} />);
    const list = screen.getByTestId("jobs-list");

    list.tabIndex = -1;
    list.focus();
    const wasNotCancelled = fireEvent.keyDown(list, { key: "ArrowDown" });

    expect(wasNotCancelled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not use a background descendant to resume a cleared selection", () => {
    const onSelect = vi.fn();
    render(<JobsKeyboardHarness initialSelectedId={null} onSelect={onSelect} />);
    const background = screen.getByTestId("list-background");

    background.focus();
    const wasNotCancelled = fireEvent.keyDown(background, { key: "ArrowDown" });

    expect(wasNotCancelled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not intercept controls outside the jobs list", () => {
    const onSelect = vi.fn();
    render(<JobsKeyboardHarness onSelect={onSelect} />);
    const outsideControl = screen.getByRole("button", { name: "Outside control" });

    outsideControl.focus();
    const wasNotCancelled = fireEvent.keyDown(outsideControl, { key: "ArrowDown" });

    expect(wasNotCancelled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    { initialSelectedId: "first", startName: "First role", key: "ArrowDown", expectedId: "second", expectedName: "Second role" },
    { initialSelectedId: "first", startName: "First role", key: "j", expectedId: "second", expectedName: "Second role" },
    { initialSelectedId: "second", startName: "Second role", key: "ArrowUp", expectedId: "first", expectedName: "First role" },
    { initialSelectedId: "second", startName: "Second role", key: "k", expectedId: "first", expectedName: "First role" },
  ])(
    "moves selection and focus with $key from an owned row",
    async ({ initialSelectedId, startName, key, expectedId, expectedName }) => {
      const onSelect = vi.fn();
      const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
      render(
        <JobsKeyboardHarness
          initialSelectedId={initialSelectedId}
          onSelect={onSelect}
        />,
      );
      const start = screen.getByRole("button", { name: startName });
      const expected = screen.getByRole("button", { name: expectedName });
      const focus = vi.spyOn(expected, "focus");

      start.focus();
      fireEvent.keyDown(start, { key });

      expect(onSelect).toHaveBeenCalledWith(expectedId);
      await waitFor(() => expect(expected).toHaveFocus());
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    },
  );

  it.each([
    { key: "ArrowDown", expectedId: "first", expectedName: "First role" },
    { key: "j", expectedId: "first", expectedName: "First role" },
    { key: "ArrowUp", expectedId: "second", expectedName: "Second role" },
    { key: "k", expectedId: "second", expectedName: "Second role" },
  ])(
    "resumes a cleared selection from the list root with $key",
    async ({ key, expectedId, expectedName }) => {
      const onSelect = vi.fn();
      render(<JobsKeyboardHarness initialSelectedId={null} onSelect={onSelect} />);
      const list = screen.getByTestId("jobs-list");
      const expected = screen.getByRole("button", { name: expectedName });

      list.focus();
      const wasNotCancelled = fireEvent.keyDown(list, { key });

      expect(wasNotCancelled).toBe(false);
      expect(onSelect).toHaveBeenCalledWith(expectedId);
      await waitFor(() => expect(expected).toHaveFocus());
    },
  );

  it("clears selection and focuses the list with Escape while a row owns focus", async () => {
    const onSelect = vi.fn();
    render(<JobsKeyboardHarness onSelect={onSelect} />);
    const first = screen.getByRole("button", { name: "First role" });
    const list = screen.getByTestId("jobs-list");
    const focus = vi.spyOn(list, "focus");

    first.focus();
    const wasNotCancelled = fireEvent.keyDown(first, { key: "Escape" });

    expect(wasNotCancelled).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(null);
    await waitFor(() => expect(list).toHaveFocus());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(first).not.toHaveAttribute("aria-current");
  });

  it("leaves boundary keys unhandled when selection cannot move", () => {
    const onSelect = vi.fn();
    render(<JobsKeyboardHarness onSelect={onSelect} />);
    const first = screen.getByRole("button", { name: "First role" });

    first.focus();
    const wasNotCancelled = fireEvent.keyDown(first, { key: "ArrowUp" });

    expect(wasNotCancelled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("cancels a pending row-focus retry when the list unmounts", async () => {
    const prepareRowFocus = vi.fn();
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(73);
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { unmount } = render(<MissingTargetHarness prepareRowFocus={prepareRowFocus} />);
    const first = screen.getByRole("button", { name: "First role" });

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(prepareRowFocus).toHaveBeenCalledWith(1);
    expect(requestFrame).toHaveBeenCalled();
    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(73);
  });

  it("does not let a pending virtual focus override an external selection", async () => {
    let pendingFrame: FrameRequestCallback | null = null;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return 91;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const onSelect = vi.fn();
    const prepareRowFocus = vi.fn();
    const { rerender } = render(
      <ExternalSelectionHarness
        selectedId="first"
        renderPendingTarget={false}
        onSelect={onSelect}
        prepareRowFocus={prepareRowFocus}
      />,
    );
    const first = screen.getByRole("button", { name: "First role" });

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSelect).toHaveBeenCalledWith("second");
    expect(requestFrame).toHaveBeenCalled();
    rerender(
      <ExternalSelectionHarness
        selectedId="third"
        renderPendingTarget
        onSelect={onSelect}
        prepareRowFocus={prepareRowFocus}
      />,
    );
    const second = screen.getByRole("button", { name: "Second role" });
    const third = screen.getByRole("button", { name: "Third role" });
    third.focus();

    expect(cancelFrame).toHaveBeenCalledWith(91);
    act(() => pendingFrame?.(0));

    expect(third).toHaveFocus();
    expect(second).not.toHaveFocus();
  });
});
