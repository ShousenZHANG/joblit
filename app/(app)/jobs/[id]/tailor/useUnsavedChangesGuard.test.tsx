import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

afterEach(() => {
  // vitest runs without `globals`, so Testing Library never registers its own
  // auto-cleanup. Without this the first test's listener stays attached and
  // every later assertion sees a prevented close.
  cleanup();
  vi.restoreAllMocks();
});

function fireBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useUnsavedChangesGuard", () => {
  it("blocks a close while work is unsaved", () => {
    renderHook(() => useUnsavedChangesGuard(true));
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it("lets a clean page close without a prompt", () => {
    renderHook(() => useUnsavedChangesGuard(false));
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it("stops blocking once the work is saved", () => {
    const { rerender } = renderHook(
      ({ dirty }) => useUnsavedChangesGuard(dirty),
      { initialProps: { dirty: true } },
    );
    expect(fireBeforeUnload().defaultPrevented).toBe(true);

    rerender({ dirty: false });
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it("removes its listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));
    unmount();

    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
