import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteTransition } from "./RouteTransition";

const capturedMotionProps: Record<string, unknown>[] = [];

vi.mock("next/navigation", () => ({
  usePathname: () => "/jobs",
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => {
      capturedMotionProps.push(props as Record<string, unknown>);
      return <div {...props}>{children}</div>;
    },
  },
  useReducedMotion: () => false,
}));

describe("RouteTransition", () => {
  it("enters with a fade-scale and never defines an exit (no serial wait)", () => {
    capturedMotionProps.length = 0;

    render(
      <RouteTransition>
        <div>Content</div>
      </RouteTransition>,
    );

    const wrapper = screen.getByText("Content").closest('div[data-route-transition="fade"]');
    expect(wrapper).toBeTruthy();
    expect(wrapper).toHaveAttribute("data-route-transition", "fade");

    const motionProps = capturedMotionProps[0] ?? {};
    expect(motionProps.initial).toEqual({ opacity: 0, scale: 0.985 });
    expect(motionProps.animate).toEqual({ opacity: 1, scale: 1 });
    // Exit + AnimatePresence mode="wait" taxed every navigation with a serial
    // ~220ms delay and could flash new content mid-exit under the App Router.
    // Navigation must respond immediately: enter-only.
    expect(motionProps.exit).toBeUndefined();
  });
});
