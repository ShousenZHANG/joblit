import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSuppressedJobRows } from "./useSuppressedJobRows";
import { sessionDeletedJobIds } from "./useJobMutations";

/**
 * Hiding a row and capturing the viewport anchor are one operation.
 *
 * They used to be two calls at six sites in `useJobMutations`, each repeating
 * the same set add/remove logic, with the anchor ref and restore effect in
 * `JobsClient`. Nothing here asserts their relative order: inverting them
 * inside `hideJobs` leaves these tests and the JobsClient integration case
 * green, because React batches the state update and the DOM is unchanged until
 * the next render. What these do pin is that the operation is whole — a caller
 * cannot hide a row without arming the compensation.
 */

function mountViewport() {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  viewport.setAttribute("data-radix-scroll-area-viewport", "");
  Object.defineProperty(viewport, "scrollTop", { value: 120, writable: true });
  viewport.getBoundingClientRect = () =>
    ({ top: 0, bottom: 500 }) as DOMRect;

  for (const id of ["job-a", "job-b", "job-c"]) {
    const row = document.createElement("div");
    row.dataset.jobId = id;
    row.getBoundingClientRect = () =>
      ({ top: 40, bottom: 90 }) as DOMRect;
    viewport.appendChild(row);
  }
  root.appendChild(viewport);
  document.body.appendChild(root);
  return { root, viewport };
}

let mounted: ReturnType<typeof mountViewport>;

beforeEach(() => {
  sessionDeletedJobIds.clear();
  document.body.innerHTML = "";
  mounted = mountViewport();
});

afterEach(() => {
  cleanup();
  sessionDeletedJobIds.clear();
});

function render() {
  const scrollRef = { current: mounted.root as HTMLDivElement | null };
  return renderHook(() => useSuppressedJobRows({ scrollRef }));
}

describe("useSuppressedJobRows", () => {
  it("hides a job and reveals it again", () => {
    const { result } = render();

    act(() => result.current.hideJobs(["job-b"]));
    expect([...result.current.suppressedDeletedIds]).toEqual(["job-b"]);

    act(() => result.current.revealJobs(["job-b"]));
    expect([...result.current.suppressedDeletedIds]).toEqual([]);
  });

  it("hides several jobs at once", () => {
    const { result } = render();
    act(() => result.current.hideJobs(["job-a", "job-c"]));
    expect([...result.current.suppressedDeletedIds].sort()).toEqual([
      "job-a",
      "job-c",
    ]);
  });

  it("captures the viewport as part of hiding a row above it", () => {
    // Capture disables native overflow anchoring so the browser does not apply
    // a second, competing correction. Seeing that flag proves the measurement
    // ran inside hideJobs rather than being left to the caller.
    const { result } = render();
    expect(mounted.viewport.style.overflowAnchor).toBe("");
    const row = mounted.viewport.querySelector<HTMLElement>(
      '[data-job-id="job-b"]',
    )!;
    row.getBoundingClientRect = () =>
      ({ top: -90, bottom: -40 }) as DOMRect;

    act(() => result.current.hideJobs(["job-b"]));
    expect(mounted.viewport.style.overflowAnchor).toBe("none");
  });

  it("does not compensate a visible deletion or change its scroll position", () => {
    const { result } = render();
    const before = mounted.viewport.scrollTop;

    act(() => result.current.hideJobs(["job-b"]));
    expect(mounted.viewport.style.overflowAnchor).toBe("");
    mounted.viewport.querySelector('[data-job-id="job-b"]')?.remove();
    act(() => result.current.restoreAnchor());

    expect(mounted.viewport.style.overflowAnchor).toBe("");
    expect(mounted.viewport.scrollTop).toBe(before);
  });

  it("anchors against a row that is staying, not one being hidden", () => {
    // The anchor has to be a row that survives the render. Hiding job-a and
    // anchoring to it would leave nothing to measure against afterwards, and
    // the list would fall back to the raw offset — the jump this exists to
    // prevent. Proven by removing every row except the anchor's and checking
    // the offset path ran rather than the fallback.
    const { result } = render();
    mounted.viewport.querySelector<HTMLElement>(
      '[data-job-id="job-a"]',
    )!.getBoundingClientRect = () =>
      ({ top: -90, bottom: -40 }) as DOMRect;
    act(() => result.current.hideJobs(["job-a"]));

    mounted.viewport.querySelector('[data-job-id="job-a"]')?.remove();
    mounted.viewport.scrollTop = 0;
    act(() => result.current.restoreAnchor());

    // Anchor found (job-b, still present) => offset compensation, not the
    // scrollTop fallback of 120.
    expect(mounted.viewport.scrollTop).not.toBe(120);
  });

  it("captures on reveal too, so a rollback does not jump either", () => {
    const { result } = render();
    mounted.viewport.querySelector<HTMLElement>(
      '[data-job-id="job-b"]',
    )!.getBoundingClientRect = () =>
      ({ top: -90, bottom: -40 }) as DOMRect;
    act(() => result.current.hideJobs(["job-b"]));
    act(() => result.current.restoreAnchor());
    mounted.viewport.style.overflowAnchor = "";

    act(() => result.current.revealJobs(["job-b"]));
    expect(mounted.viewport.style.overflowAnchor).toBe("none");
  });

  it("restores the scroll position once, then forgets the snapshot", () => {
    const { result } = render();
    mounted.viewport.querySelector<HTMLElement>(
      '[data-job-id="job-b"]',
    )!.getBoundingClientRect = () =>
      ({ top: -90, bottom: -40 }) as DOMRect;
    act(() => result.current.hideJobs(["job-b"]));

    // The anchored row is gone, so the fallback restores the raw offset.
    for (const row of Array.from(
      mounted.viewport.querySelectorAll("[data-job-id]"),
    )) {
      row.remove();
    }
    mounted.viewport.scrollTop = 0;

    act(() => result.current.restoreAnchor());
    expect(mounted.viewport.scrollTop).toBe(120);

    mounted.viewport.scrollTop = 5;
    act(() => result.current.restoreAnchor());
    expect(mounted.viewport.scrollTop).toBe(5);
  });

  it("restores native overflow anchoring after compensating for a deletion above the viewport", () => {
    const viewport = mounted.viewport;
    viewport.getBoundingClientRect = () =>
      ({ top: 100, bottom: 600 }) as DOMRect;
    const rows = viewport.querySelectorAll<HTMLElement>("[data-job-id]");
    rows[0]!.getBoundingClientRect = () =>
      ({ top: 0, bottom: 80 }) as DOMRect;
    rows[1]!.getBoundingClientRect = () =>
      ({ top: 120, bottom: 170 }) as DOMRect;
    rows[2]!.getBoundingClientRect = () =>
      ({ top: 180, bottom: 230 }) as DOMRect;

    const { result } = render();
    act(() => result.current.hideJobs(["job-a"]));
    expect(viewport.style.overflowAnchor).toBe("none");

    rows[0]!.remove();
    act(() => result.current.restoreAnchor());

    expect(viewport.style.overflowAnchor).toBe("");
  });

  it("does nothing when there is no viewport to measure", () => {
    const { result } = renderHook(() =>
      useSuppressedJobRows({ scrollRef: { current: null } }),
    );
    act(() => result.current.hideJobs(["job-b"]));
    expect([...result.current.suppressedDeletedIds]).toEqual(["job-b"]);
    act(() => result.current.restoreAnchor());
  });

  it("seeds from the session tombstones so a remount keeps deletes hidden", () => {
    // A flushed DELETE can still be in flight when the user navigates away and
    // back; the row must not reappear in the meantime.
    sessionDeletedJobIds.add("job-c");
    const { result } = render();
    expect([...result.current.suppressedDeletedIds]).toEqual(["job-c"]);
  });

  it("keeps the same set identity when hiding an already hidden job", () => {
    // useJobPagination filters on this set; a new identity for no change would
    // recompute the visible list for nothing.
    const { result } = render();
    act(() => result.current.hideJobs(["job-b"]));
    const first = result.current.suppressedDeletedIds;

    act(() => result.current.hideJobs(["job-b"]));
    expect(result.current.suppressedDeletedIds).toBe(first);
  });

  it("keeps the same set identity when revealing a job that was not hidden", () => {
    const { result } = render();
    const first = result.current.suppressedDeletedIds;
    act(() => result.current.revealJobs(["job-b"]));
    expect(result.current.suppressedDeletedIds).toBe(first);
  });
});
