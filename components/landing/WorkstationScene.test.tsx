import { act, cleanup, render, waitFor } from "@testing-library/react";
import { motionValue } from "framer-motion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkstationScene, { advanceWorkstationMotion } from "./WorkstationScene";

const gpu = vi.hoisted(() => ({
  construct: vi.fn(),
  configure: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
  dispose: vi.fn(),
  forceContextLoss: vi.fn(),
}));

vi.mock("three", async (importOriginal) => ({
  ...await importOriginal<typeof import("three")>(),
  WebGLRenderer: class {
    constructor(options: unknown) { gpu.construct(options); }
    dispose = gpu.dispose;
    forceContextLoss = gpu.forceContextLoss;
  },
}));

vi.mock("@react-three/fiber", async () => {
  const { createElement } = await import("react");
  return {
    // R3F mounts this HTML content on every browser, not only unsupported ones.
    // Keep that real contract here to catch a fallback side effect regression.
    Canvas: ({ fallback }: { fallback: React.ReactNode }) => createElement("canvas", null, fallback),
    createRoot: () => ({ configure: gpu.configure, render: gpu.render, unmount: gpu.unmount }),
    unmountComponentAtNode: (canvas: HTMLCanvasElement, callback: () => void) => gpu.unmount(canvas, callback),
    extend: vi.fn(),
    useFrame: vi.fn(),
    useThree: vi.fn(),
  };
});

vi.mock("@react-three/drei", () => ({
  Environment: () => null,
  Lightformer: () => null,
  RoundedBox: () => null,
}));

describe("workstation motion lifecycle", () => {
  it("settles at the same pace on 30 Hz and 120 Hz displays", () => {
    const run = (fps: number) => {
      const motion = { progress: 0, pitch: 0, yaw: 0 };
      for (let frame = 0; frame < fps / 2; frame++) {
        advanceWorkstationMotion(motion, 0.5, { x: 0.6, y: -0.4 }, true, 1 / fps);
      }
      return motion;
    };

    const slow = run(30);
    const fast = run(120);
    expect(slow.progress).toBeCloseTo(fast.progress, 6);
    expect(slow.pitch).toBeCloseTo(fast.pitch, 6);
    expect(slow.yaw).toBeCloseTo(fast.yaw, 6);
    expect(slow.progress).toBeGreaterThan(0.49);
  });

  it("releases demand rendering after a transition and supports reversing it", () => {
    const motion = { progress: 0, pitch: 0, yaw: 0 };
    const pointer = { x: 0.5, y: 0.3 };
    let needsFrame = true;
    for (let frame = 0; frame < 180 && needsFrame; frame++) {
      needsFrame = advanceWorkstationMotion(motion, 1, pointer, true, 1 / 60);
    }
    expect(needsFrame).toBe(false);
    expect(motion.progress).toBe(1);

    expect(advanceWorkstationMotion(motion, 0, pointer, true, 1 / 60)).toBe(true);
    expect(motion.progress).toBeGreaterThan(0);
    expect(motion.progress).toBeLessThan(1);
    for (let frame = 0; frame < 180; frame++) {
      needsFrame = advanceWorkstationMotion(motion, 0, pointer, true, 1 / 60);
    }
    expect(needsFrame).toBe(false);
    expect(motion.progress).toBe(0);
  });

  it("renders a chapter immediately without scheduling motion when inactive", () => {
    const motion = { progress: 0.2, pitch: 0.03, yaw: -0.04 };

    expect(advanceWorkstationMotion(motion, 0.5, { x: 1, y: 1 }, false, 1 / 60)).toBe(false);
    expect(motion).toEqual({ progress: 0.5, pitch: 0, yaw: 0 });
  });
});

describe("workstation graphics availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gpu.construct.mockImplementation(() => undefined);
    gpu.configure.mockResolvedValue(undefined);
    gpu.unmount.mockImplementation((_canvas: HTMLCanvasElement, callback: () => void) => callback());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 640, height: 620, top: 0, left: 0, right: 640, bottom: 620, x: 0, y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the scene available when the canvas fallback content mounts", async () => {
    const onUnavailable = vi.fn();
    const { container } = render(<WorkstationScene progress={motionValue(0)} paused={false} onUnavailable={onUnavailable} />);

    await waitFor(() => expect(gpu.render).toHaveBeenCalled());
    expect(container.querySelector("canvas")).toHaveTextContent("An illustrative 3D job-search workstation.");
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("reuses the canvas and renderer while switching between light and dark", async () => {
    const progress = motionValue(0.6);
    const onUnavailable = vi.fn();
    const { container, rerender } = render(<WorkstationScene progress={progress} paused={false} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(gpu.render).toHaveBeenCalled());
    const originalCanvas = container.querySelector("canvas");
    gpu.render.mockClear();

    rerender(<WorkstationScene progress={progress} paused={false} dark onUnavailable={onUnavailable} />);
    rerender(<WorkstationScene progress={progress} paused={false} dark={false} onUnavailable={onUnavailable} />);

    expect(gpu.render).toHaveBeenCalledTimes(2);
    expect(container.querySelector("canvas")).toBe(originalCanvas);
    expect(gpu.construct).toHaveBeenCalledTimes(1);
    expect(gpu.dispose).not.toHaveBeenCalled();
    expect(gpu.unmount).not.toHaveBeenCalled();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("reports an actual WebGL renderer construction failure", () => {
    gpu.construct.mockImplementation(() => { throw new Error("WebGL2 is unavailable"); });
    const onUnavailable = vi.fn();
    render(<WorkstationScene progress={motionValue(0)} paused={false} onUnavailable={onUnavailable} />);

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(gpu.configure).not.toHaveBeenCalled();
    expect(gpu.render).not.toHaveBeenCalled();
  });

  it("catches asynchronous renderer configuration failures", async () => {
    gpu.configure.mockRejectedValue(new Error("Renderer configuration failed"));
    const onUnavailable = vi.fn();
    render(<WorkstationScene progress={motionValue(0)} paused={false} onUnavailable={onUnavailable} />);

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(gpu.render).not.toHaveBeenCalled();
    expect(gpu.unmount).toHaveBeenCalled();
  });

  it("reports context loss once and stops the rendered root", async () => {
    const onUnavailable = vi.fn();
    const { container } = render(<WorkstationScene progress={motionValue(0)} paused={false} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(gpu.render).toHaveBeenCalled());
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();

    act(() => {
      canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(gpu.unmount).toHaveBeenCalledTimes(1);
  });

  it("does not render or signal a late failure after unmount", async () => {
    let rejectConfiguration: (error: Error) => void = () => undefined;
    gpu.configure.mockReturnValue(new Promise((_resolve, reject) => { rejectConfiguration = reject; }));
    const onUnavailable = vi.fn();
    const { unmount } = render(<WorkstationScene progress={motionValue(0)} paused={false} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(gpu.configure).toHaveBeenCalled());
    unmount();

    await act(async () => { rejectConfiguration(new Error("Late GPU failure")); });

    expect(onUnavailable).not.toHaveBeenCalled();
    expect(gpu.render).not.toHaveBeenCalled();
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the renderer only after asynchronous scene cleanup, once", async () => {
    let finishSceneCleanup: () => void = () => undefined;
    gpu.unmount.mockImplementation((_canvas: HTMLCanvasElement, callback: () => void) => { finishSceneCleanup = callback; });
    const { container, unmount } = render(<WorkstationScene progress={motionValue(0)} paused={false} />);
    await waitFor(() => expect(gpu.render).toHaveBeenCalled());

    act(() => { container.querySelector("canvas")?.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); });
    unmount();

    expect(gpu.unmount).toHaveBeenCalledTimes(1);
    expect(gpu.dispose).not.toHaveBeenCalled();
    finishSceneCleanup();
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
  });
});
