import { describe, expect, it } from "vitest";
import {
  ACTIVE_JOB_STATUS_VALUES,
  JOB_STATUS_VALUES,
  canTransitionJobStatus,
  isActiveJobStatus,
  isJobStatus,
  selectableJobStatuses,
  toActiveJobStatus,
} from "./jobStatus";

describe("job status model", () => {
  it("offers exactly the three triage states", () => {
    expect(ACTIVE_JOB_STATUS_VALUES).toEqual(["NEW", "APPLIED", "REJECTED"]);
  });

  it("still parses retired statuses so ledger history stays readable", () => {
    for (const status of JOB_STATUS_VALUES) {
      expect(isJobStatus(status)).toBe(true);
    }
    expect(isActiveJobStatus("INTERVIEW")).toBe(false);
    expect(isJobStatus("INTERVIEW")).toBe(true);
  });

  it("rejects values that were never statuses", () => {
    for (const value of ["", "new", "PENDING", null, undefined, 3]) {
      expect(isJobStatus(value)).toBe(false);
      expect(isActiveJobStatus(value)).toBe(false);
    }
  });
});

describe("toActiveJobStatus", () => {
  it("passes active statuses through untouched", () => {
    expect(toActiveJobStatus("NEW")).toBe("NEW");
    expect(toActiveJobStatus("APPLIED")).toBe("APPLIED");
    expect(toActiveJobStatus("REJECTED")).toBe("REJECTED");
  });

  it("reads every progressing state as applied", () => {
    // Interview, offer and acceptance all mean the application is live.
    expect(toActiveJobStatus("INTERVIEW")).toBe("APPLIED");
    expect(toActiveJobStatus("OFFER")).toBe("APPLIED");
    expect(toActiveJobStatus("ACCEPTED")).toBe("APPLIED");
  });

  it("reads withdrawal as ruled out", () => {
    expect(toActiveJobStatus("WITHDRAWN")).toBe("REJECTED");
  });

  it("maps every stored status onto an active one", () => {
    // No row can become unreachable on a board that filters by active status.
    for (const status of JOB_STATUS_VALUES) {
      expect(ACTIVE_JOB_STATUS_VALUES).toContain(toActiveJobStatus(status));
    }
  });
});

describe("canTransitionJobStatus", () => {
  it("allows every move between the three active states", () => {
    expect(canTransitionJobStatus("NEW", "APPLIED")).toBe(true);
    expect(canTransitionJobStatus("NEW", "REJECTED")).toBe(true);
    expect(canTransitionJobStatus("APPLIED", "REJECTED")).toBe(true);
    expect(canTransitionJobStatus("APPLIED", "NEW")).toBe(true);
    expect(canTransitionJobStatus("REJECTED", "NEW")).toBe(true);
    expect(canTransitionJobStatus("REJECTED", "APPLIED")).toBe(true);
  });

  it("refuses a no-op", () => {
    for (const status of ACTIVE_JOB_STATUS_VALUES) {
      expect(canTransitionJobStatus(status, status)).toBe(false);
    }
  });

  it("never moves a job into a retired status", () => {
    for (const target of ["INTERVIEW", "OFFER", "WITHDRAWN", "ACCEPTED"] as const) {
      expect(canTransitionJobStatus("NEW", target)).toBe(false);
      expect(canTransitionJobStatus("APPLIED", target)).toBe(false);
    }
  });

  it("lets a legacy row move out of a retired status", () => {
    // A row the migration missed must not be stuck: it is read as APPLIED, so
    // the moves available from APPLIED apply to it.
    expect(canTransitionJobStatus("INTERVIEW", "REJECTED")).toBe(true);
    expect(canTransitionJobStatus("OFFER", "NEW")).toBe(true);
    expect(canTransitionJobStatus("WITHDRAWN", "APPLIED")).toBe(true);
    // ...but not onto the state it already reads as.
    expect(canTransitionJobStatus("INTERVIEW", "APPLIED")).toBe(false);
    expect(canTransitionJobStatus("WITHDRAWN", "REJECTED")).toBe(false);
  });
});

describe("selectableJobStatuses", () => {
  it("leads with the current status followed by its moves", () => {
    expect(selectableJobStatuses("NEW")).toEqual(["NEW", "APPLIED", "REJECTED"]);
    expect(selectableJobStatuses("APPLIED")).toEqual([
      "APPLIED",
      "NEW",
      "REJECTED",
    ]);
  });

  it("presents a legacy row under its projected status", () => {
    expect(selectableJobStatuses("OFFER")).toEqual([
      "APPLIED",
      "NEW",
      "REJECTED",
    ]);
  });

  it("only ever offers active statuses", () => {
    for (const status of JOB_STATUS_VALUES) {
      for (const option of selectableJobStatuses(status)) {
        expect(ACTIVE_JOB_STATUS_VALUES).toContain(option);
      }
    }
  });
});
