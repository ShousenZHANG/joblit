import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBatchCompletionSignal } from "./useBatchCompletionSignal";
import type { BatchProgressState } from "./useBatchProgress";

const LABELS = {
  titlePrefix: ({ done, total }: { done: number; total: number }) =>
    `(${done}/${total}) Generating`,
  doneTitle: "Generation finished",
  failedTitle: "Generation failed",
  doneDescription: ({
    succeeded,
    failed,
  }: {
    succeeded: number;
    failed: number;
  }) => `${succeeded} ready, ${failed} failed.`,
};

function state(overrides: Partial<BatchProgressState>): BatchProgressState {
  return {
    batchId: "batch-1",
    status: "RUNNING",
    pending: 0,
    running: 1,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    done: 0,
    total: 2,
    active: true,
    ...overrides,
  } as BatchProgressState;
}

const ORIGINAL_TITLE = "Joblit";

afterEach(() => {
  document.title = ORIGINAL_TITLE;
});

describe("useBatchCompletionSignal", () => {
  it("puts live progress in the tab title and restores it when the run ends", () => {
    document.title = ORIGINAL_TITLE;
    const toast = vi.fn();
    const { rerender } = renderHook(
      (props: { state: BatchProgressState }) =>
        useBatchCompletionSignal({ state: props.state, toast, labels: LABELS }),
      { initialProps: { state: state({ done: 1, total: 3 }) } },
    );

    // The title is the only channel that reaches a user who switched tabs,
    // which is what anyone does while waiting several minutes.
    expect(document.title).toBe("(1/3) Generating");

    rerender({
      state: state({ active: false, status: "SUCCEEDED", done: 3, total: 3 }),
    });
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("announces a settled run exactly once", () => {
    const toast = vi.fn();
    const { rerender } = renderHook(
      (props: { state: BatchProgressState }) =>
        useBatchCompletionSignal({ state: props.state, toast, labels: LABELS }),
      { initialProps: { state: state({}) } },
    );
    expect(toast).not.toHaveBeenCalled();

    const settled = state({
      active: false,
      status: "SUCCEEDED",
      succeeded: 2,
      done: 2,
    });
    rerender({ state: settled });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: "Generation finished",
      description: "2 ready, 0 failed.",
      variant: "default",
    });

    // Polling keeps delivering the same terminal summary. A toast per poll
    // would bury the page in duplicates of the same news.
    rerender({ state: { ...settled } });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("stays silent about a run this session never saw running", () => {
    // Otherwise every visit to the Jobs page toasts about whatever finished
    // last, which could be days old, and the signal stops meaning anything.
    const toast = vi.fn();
    renderHook(() =>
      useBatchCompletionSignal({
        state: state({ active: false, status: "SUCCEEDED", succeeded: 2, done: 2 }),
        toast,
        labels: LABELS,
      }),
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it("marks a run where nothing succeeded as a failure", () => {
    const toast = vi.fn();
    const { rerender } = renderHook(
      (props: { state: BatchProgressState }) =>
        useBatchCompletionSignal({ state: props.state, toast, labels: LABELS }),
      { initialProps: { state: state({}) } },
    );

    rerender({
      state: state({
        active: false,
        status: "FAILED",
        succeeded: 0,
        failed: 2,
        done: 2,
      }),
    });
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: "Generation failed",
      variant: "destructive",
    });
  });

  it("announces a second run after the first was already announced", () => {
    const toast = vi.fn();
    const { rerender } = renderHook(
      (props: { state: BatchProgressState }) =>
        useBatchCompletionSignal({ state: props.state, toast, labels: LABELS }),
      { initialProps: { state: state({}) } },
    );
    rerender({
      state: state({ active: false, status: "SUCCEEDED", succeeded: 2, done: 2 }),
    });

    rerender({ state: state({ batchId: "batch-2" }) });
    rerender({
      state: state({
        batchId: "batch-2",
        active: false,
        status: "SUCCEEDED",
        succeeded: 1,
        done: 1,
      }),
    });
    expect(toast).toHaveBeenCalledTimes(2);
  });
});
