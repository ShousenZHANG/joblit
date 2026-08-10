import { describe, expect, it } from "vitest";
import { jobTailoringDisplayState } from "./JobTailoringBadge";

/**
 * The precedence rule is the whole point of this helper: the row already knows
 * about a finished Application, and a regenerate in flight has to win over it.
 */
describe("jobTailoringDisplayState", () => {
  it("shows nothing for an untouched Job", () => {
    expect(
      jobTailoringDisplayState({ tailoringState: "idle", applicationId: null }),
    ).toBeNull();
  });

  it("treats a missing state as untouched rather than as a badge", () => {
    // Responses cached before this field shipped simply omit it. They must not
    // render as an unlabelled chip.
    expect(
      jobTailoringDisplayState({ applicationId: null } as never),
    ).toBeNull();
  });

  it("calls a Job with an Application ready", () => {
    expect(
      jobTailoringDisplayState({
        tailoringState: "idle",
        applicationId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("ready");
  });

  it("lets a regenerate in flight outrank the Application it will replace", () => {
    // Showing "ready" here would describe the previous run, and the user would
    // have no way to tell the new one had started.
    expect(
      jobTailoringDisplayState({
        tailoringState: "running",
        applicationId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("running");
  });

  it("keeps a stalled Job distinguishable from a running one", () => {
    expect(
      jobTailoringDisplayState({
        tailoringState: "stalled",
        applicationId: null,
      }),
    ).toBe("stalled");
  });
});
