import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useKeyboardNavigation } from "./useKeyboardNavigation";

const items = [{ id: "first" }, { id: "second" }];

function JobsKeyboardHarness({
  initialSelectedId = "first",
  onSelect,
}: {
  initialSelectedId?: string;
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
      <div ref={containerRef} data-testid="jobs-list">
        <button
          type="button"
          data-job-id="first"
          tabIndex={selectedId === "first" ? 0 : -1}
          aria-current={selectedId === "first" ? "true" : undefined}
        >
          First role
        </button>
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useKeyboardNavigation", () => {
  it.each([
    "input",
    "textarea",
    "select",
    "a[href]",
    "[contenteditable='true']",
    "[role='dialog']",
    "[role='menu']",
    "[role='listbox']",
    "[role='combobox']",
  ])("does not intercept nested %s keyboard behavior", (selector) => {
    const onSelect = vi.fn();
    render(<JobsKeyboardHarness onSelect={onSelect} />);
    const list = screen.getByTestId("jobs-list");
    const target = list.querySelector<HTMLElement>(selector);
    expect(target).not.toBeNull();

    target!.focus();
    const wasNotCancelled = fireEvent.keyDown(target!, { key: "ArrowDown" });

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

  it("clears selection with Escape while a row owns focus", () => {
    const onSelect = vi.fn();
    render(<JobsKeyboardHarness onSelect={onSelect} />);
    const first = screen.getByRole("button", { name: "First role" });

    first.focus();
    const wasNotCancelled = fireEvent.keyDown(first, { key: "Escape" });

    expect(wasNotCancelled).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(null);
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
});
