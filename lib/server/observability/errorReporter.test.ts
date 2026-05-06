import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEvent, reportError } from "./errorReporter";

describe("errorReporter", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  it("reports Error instances with stack and scope", () => {
    const err = new Error("boom");
    reportError(err, { scope: "fetch-runs.create", userId: "u1" });

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(consoleErrorSpy.mock.calls[0]?.[0] as string);
    expect(payload).toMatchObject({
      type: "error",
      service: "joblit-web",
      severity: "error",
      scope: "fetch-runs.create",
      message: "boom",
      userId: "u1",
    });
    expect(payload.stack).toContain("boom");
  });

  it("reports unknown errors via JSON stringify", () => {
    reportError({ code: 500, body: "fail" }, { scope: "unknown" });
    const payload = JSON.parse(consoleErrorSpy.mock.calls[0]?.[0] as string);
    expect(payload.message).toBe('{"code":500,"body":"fail"}');
  });

  it("captures non-error events with custom severity", () => {
    captureEvent({
      name: "batch.completed",
      severity: "info",
      tags: { batchId: "b1" },
    });
    expect(consoleInfoSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(consoleInfoSpy.mock.calls[0]?.[0] as string);
    expect(payload).toMatchObject({
      type: "event",
      name: "batch.completed",
      severity: "info",
      tags: { batchId: "b1" },
    });
  });

  it("defaults reportError severity to error and captureEvent to info", () => {
    reportError(new Error("x"), { scope: "s" });
    expect(JSON.parse(consoleErrorSpy.mock.calls[0]?.[0] as string).severity).toBe("error");

    captureEvent({ name: "y" });
    expect(JSON.parse(consoleInfoSpy.mock.calls[0]?.[0] as string).severity).toBe("info");
  });
});
