import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { FetchProgressPanel } from "./FetchProgressPanel";

type CapturedMotionProps = {
  animate?: unknown;
  transition?: unknown;
};

const motionTestState = vi.hoisted(() => ({
  reducedMotion: false,
  open: true,
  status: "RUNNING",
  importedCount: 0,
  error: null as string | null,
  cancelling: false,
  cancelError: null as string | null,
  cancelRun: vi.fn(),
  lanes: [] as Array<{
    id: string;
    source: "jobspy" | "seek" | "nowcoder" | "global";
    status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
    importedCount: number;
  }>,
  circles: [] as CapturedMotionProps[],
  divs: [] as CapturedMotionProps[],
  buttons: [] as CapturedMotionProps[],
}));

vi.mock("framer-motion", async () => {
  const { createElement, Fragment } = await import("react");
  const motionOnlyProps = new Set([
    "animate",
    "children",
    "exit",
    "initial",
    "transition",
  ]);

  type MockMotionProps = {
    children?: ReactNode;
    animate?: unknown;
    transition?: unknown;
    [key: string]: unknown;
  };

  const createMotionElement = (tag: "button" | "circle" | "div") => {
    function MockMotionElement(props: MockMotionProps) {
      const captured = {
        animate: props.animate,
        transition: props.transition,
      };
      if (tag === "circle") motionTestState.circles.push(captured);
      if (tag === "div") motionTestState.divs.push(captured);
      if (tag === "button") motionTestState.buttons.push(captured);

      const domProps = Object.fromEntries(
        Object.entries(props).filter(([key]) => !motionOnlyProps.has(key)),
      );
      return createElement(tag, domProps, props.children);
    }

    return MockMotionElement;
  };

  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) =>
      createElement(Fragment, null, children),
    motion: {
      button: createMotionElement("button"),
      circle: createMotionElement("circle"),
      div: createMotionElement("div"),
    },
    useReducedMotion: () => motionTestState.reducedMotion,
  };
});

vi.mock("./FetchStatusContext", () => ({
  useFetchStatus: () => ({
    runId: "run-1",
    status: motionTestState.status,
    importedCount: motionTestState.importedCount,
    lanes: motionTestState.lanes,
    error: motionTestState.error,
    cancelling: motionTestState.cancelling,
    cancelError: motionTestState.cancelError,
    elapsedSeconds: 11,
    open: motionTestState.open,
    setOpen: (nextOpen: boolean) => {
      motionTestState.open = nextOpen;
    },
    startRun: vi.fn(),
    cancelRun: motionTestState.cancelRun,
    queryTitle: "Software Engineer",
    queryTerms: ["Software Engineer", "Frontend Engineer", "Backend Engineer"],
    smartExpand: true,
  }),
}));

function panelTree() {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <FetchProgressPanel />
    </NextIntlClientProvider>
  );
}

function renderPanel() {
  return render(panelTree());
}

beforeEach(() => {
  motionTestState.reducedMotion = false;
  motionTestState.open = true;
  motionTestState.status = "RUNNING";
  motionTestState.importedCount = 0;
  motionTestState.error = null;
  motionTestState.cancelling = false;
  motionTestState.cancelError = null;
  motionTestState.cancelRun.mockReset();
  motionTestState.lanes = [];
  motionTestState.circles.length = 0;
  motionTestState.divs.length = 0;
  motionTestState.buttons.length = 0;
});

afterEach(cleanup);

describe("FetchProgressPanel", () => {
  it("shows the real role queries used by smart fetch", () => {
    renderPanel();

    expect(screen.getAllByText(/software engineer/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/frontend engineer/i)).toBeInTheDocument();
    expect(screen.getByText(/backend engineer/i)).toBeInTheDocument();
    expect(screen.getByText(/smart fetch expanded/i)).toBeInTheDocument();
  });

  it("keeps the visual estimate but exposes running progress as indeterminate", () => {
    renderPanel();

    const fill = screen.getByTestId("fetch-progress-fill");
    expect(fill).toHaveStyle({ transform: "scaleX(0.42)" });
    expect(fill).toHaveClass(
      "motion-safe:transition-transform",
      "motion-safe:duration-[260ms]",
      "motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]",
    );
    const progress = screen.getByRole("progressbar", {
      name: /fetch progress/i,
    });
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress).toHaveAttribute("aria-valuetext", "Running");
  });

  it("uses the standard easing for step connector transforms", () => {
    renderPanel();

    const connector = motionTestState.divs.find(({ animate }) =>
      Boolean(animate && typeof animate === "object" && "scaleX" in animate),
    );
    expect(connector?.transition).toEqual({
      duration: 0.26,
      ease: [0.16, 1, 0.3, 1],
    });
  });

  it("updates the minimized ring immediately under reduced motion", () => {
    motionTestState.reducedMotion = true;
    motionTestState.open = false;

    renderPanel();

    const trigger = screen.getByRole("button", {
      name: /open fetch progress/i,
    });
    expect(trigger).toHaveTextContent("\u22ef");
    expect(
      trigger.querySelector(".motion-safe\\:animate-ping"),
    ).toBeInTheDocument();
    expect(motionTestState.circles).toHaveLength(1);
    expect(motionTestState.circles[0]?.transition).toEqual({ duration: 0 });
    expect(motionTestState.buttons[0]?.transition).toEqual({ duration: 0 });
  });

  it("keeps running feedback visible but disables every motion path", () => {
    motionTestState.reducedMotion = true;

    const { container } = renderPanel();

    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(container.querySelector(".lucide-loader-circle")).toHaveClass(
      "motion-safe:animate-spin",
    );
    expect(
      container.querySelector(".motion-safe\\:animate-pulse"),
    ).toHaveTextContent("2");
    expect(screen.getByTestId("fetch-progress-panel")).not.toHaveClass(
      "cosmos-scan",
    );

    const panelMotion = motionTestState.divs.find(({ animate }) =>
      Boolean(animate && typeof animate === "object" && "opacity" in animate),
    );
    const connector = motionTestState.divs.find(({ animate }) =>
      Boolean(animate && typeof animate === "object" && "scaleX" in animate),
    );
    expect(panelMotion?.transition).toEqual({ duration: 0 });
    expect(connector?.transition).toEqual({ duration: 0 });
  });

  it("suppresses success burst and confetti under reduced motion", () => {
    motionTestState.reducedMotion = true;
    motionTestState.status = "SUCCEEDED";
    motionTestState.importedCount = 2;

    const view = renderPanel();

    expect(view.container.querySelector(".animate-confetti-pop")).toBeNull();

    motionTestState.open = false;
    view.rerender(panelTree());

    expect(view.container.querySelector(".cosmos-burst")).toBeNull();
  });

  it("shows PARTIAL as a visible terminal outcome", () => {
    motionTestState.status = "PARTIAL";
    motionTestState.importedCount = 2;
    motionTestState.error = "A later batch failed";
    motionTestState.lanes = [
      {
        id: "run-1",
        source: "nowcoder",
        status: "PARTIAL",
        importedCount: 2,
      },
    ];

    const { container } = renderPanel();

    expect(screen.getByText("Partially completed")).toBeInTheDocument();
    expect(
      screen.getByText("Stopped after importing some results."),
    ).toBeInTheDocument();
    expect(screen.getByText("Imported 2 new jobs")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nowcoder didn't finish — only results saved before it stopped are included.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: /fetch progress/i }),
    ).toHaveAttribute("aria-valuenow", "100");
    expect(
      screen.getByRole("progressbar", { name: /fetch progress/i }),
    ).toHaveAttribute(
      "aria-valuetext",
      "Partially completed. Imported 2 new jobs",
    );
    const announcement = screen.getByRole("status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveAttribute("aria-atomic", "true");
    expect(announcement).toHaveTextContent("Partially completed");
    expect(announcement).toHaveTextContent("Imported 2 new jobs");
    expect(announcement).toHaveTextContent("Nowcoder didn't finish");
    expect(
      screen.queryByRole("button", { name: /cancel fetch/i }),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".animate-confetti-pop")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("A later batch failed");
  });

  it("announces imported counts and failed sources while the run continues", () => {
    motionTestState.importedCount = 3;
    motionTestState.lanes = [
      {
        id: "run-1",
        source: "jobspy",
        status: "RUNNING",
        importedCount: 3,
      },
      {
        id: "run-2",
        source: "seek",
        status: "FAILED",
        importedCount: 0,
      },
    ];

    renderPanel();

    const announcement = screen.getByTestId("fetch-progress-announcement");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveAttribute("aria-atomic", "true");
    expect(announcement).toHaveTextContent("Running");
    expect(announcement).toHaveTextContent("Imported 3 so far");
    expect(announcement).toHaveTextContent("Seek: Failed");

    const progress = screen.getByRole("progressbar", {
      name: /fetch progress/i,
    });
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress.getAttribute("aria-valuetext")).toMatch(
      /^Running\. Imported 3 so far/,
    );
  });

  it("uses touch-sized controls and returns focus to the minimized FAB", () => {
    const view = renderPanel();

    const minimize = screen.getByRole("button", { name: "Minimize" });
    const cancel = screen.getByRole("button", { name: /cancel fetch/i });
    expect(minimize).toHaveClass("h-11", "w-11");
    expect(minimize.parentElement).toHaveClass("gap-2");
    expect(cancel).toHaveClass("h-11");

    fireEvent.click(minimize);
    view.rerender(panelTree());

    const fab = screen.getByRole("button", {
      name: /open fetch progress: running/i,
    });
    expect(fab).toHaveFocus();
    expect(fab).toHaveClass("h-14", "w-14");
  });

  it("shows cancellation progress and a localized retryable failure", () => {
    motionTestState.cancelling = true;

    const view = renderPanel();

    const cancelling = screen.getByRole("button", {
      name: /cancelling fetch/i,
    });
    expect(cancelling).toBeDisabled();
    expect(cancelling).toHaveAttribute("aria-busy", "true");

    motionTestState.cancelling = false;
    motionTestState.cancelError = "internal cancellation detail";
    view.rerender(panelTree());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Some sources could not be cancelled. They are still being monitored; try cancelling again.",
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel fetch/i }));
    expect(motionTestState.cancelRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/internal cancellation detail/i)).toBeNull();
  });

  it("keeps terminal header controls at least 44 by 44 pixels", () => {
    motionTestState.status = "SUCCEEDED";

    renderPanel();

    expect(screen.getByRole("button", { name: "Minimize" })).toHaveClass(
      "h-11",
      "w-11",
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "h-11",
      "w-11",
    );
  });
});
