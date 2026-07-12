import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
  circles: [] as CapturedMotionProps[],
  divs: [] as CapturedMotionProps[],
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
    status: "RUNNING",
    importedCount: 0,
    lanes: [],
    error: null,
    elapsedSeconds: 11,
    open: motionTestState.open,
    setOpen: vi.fn(),
    startRun: vi.fn(),
    cancelRun: vi.fn(),
    queryTitle: "Software Engineer",
    queryTerms: ["Software Engineer", "Frontend Engineer", "Backend Engineer"],
    smartExpand: true,
  }),
}));

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FetchProgressPanel />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  motionTestState.reducedMotion = false;
  motionTestState.open = true;
  motionTestState.circles.length = 0;
  motionTestState.divs.length = 0;
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

  it("uses the standard easing for transform-based progress", () => {
    renderPanel();

    const fill = screen.getByTestId("fetch-progress-fill");
    expect(fill).toHaveStyle({ transform: "scaleX(0.42)" });
    expect(fill).toHaveClass(
      "transition-transform",
      "duration-[260ms]",
      "ease-[cubic-bezier(0.16,1,0.3,1)]",
      "motion-reduce:transition-none",
    );
    expect(screen.getByTestId("fetch-progress-panel")).toHaveClass(
      "motion-reduce:transition-none",
    );
    expect(
      screen.getByRole("progressbar", { name: /fetch progress/i }),
    ).toHaveAttribute("aria-valuenow", "42");
  });

  it("uses the standard easing for step connector transforms", () => {
    renderPanel();

    const connector = motionTestState.divs.find(({ animate }) =>
      Boolean(
        animate &&
          typeof animate === "object" &&
          "scaleX" in animate,
      ),
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

    const trigger = screen.getByRole("button", { name: /open fetch progress/i });
    expect(trigger).toHaveTextContent("\u22ef");
    expect(
      trigger.querySelector(".motion-safe\\:animate-ping"),
    ).toBeInTheDocument();
    expect(motionTestState.circles).toHaveLength(1);
    expect(motionTestState.circles[0]?.transition).toEqual({
      duration: 0,
      ease: [0.16, 1, 0.3, 1],
    });
  });

  it("keeps running feedback visible but static under reduced motion", () => {
    motionTestState.reducedMotion = true;

    const { container } = renderPanel();

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(container.querySelector(".lucide-loader-circle")).toHaveClass(
      "motion-reduce:animate-none",
    );
    expect(
      container.querySelector(".motion-safe\\:animate-pulse"),
    ).toHaveTextContent("2");
  });
});
