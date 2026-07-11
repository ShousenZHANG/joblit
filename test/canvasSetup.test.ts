import { describe, expect, it } from "vitest";

describe("test canvas shim", () => {
  it("provides the minimal 2D API used by accessibility checks", () => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    expect(context).not.toBeNull();
    expect(context?.canvas).toBe(canvas);
    expect(context?.measureText("Joblit").width).toBeGreaterThan(0);
    expect(context?.getImageData(0, 0, 2, 2).data).toHaveLength(16);
    expect(() => context?.fillText("J", 0, 0)).not.toThrow();
    expect(() => context?.clearRect(0, 0, 2, 2)).not.toThrow();
  });
});
