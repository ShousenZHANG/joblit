import { describe, expect, it } from "vitest";
import { JOB_STATUS_VALUES } from "@/lib/shared/jobStatus";
import { jobStatusPresentation } from "./jobStatusPresentation";

describe("jobStatusPresentation", () => {
  it("resolves every stored status to a reachable presentation", () => {
    for (const stored of JOB_STATUS_VALUES) {
      const presentation = jobStatusPresentation(stored);
      expect(["NEW", "APPLIED", "REJECTED"]).toContain(presentation.status);
      expect(presentation.badgeClass).not.toBe("");
      expect(presentation.headerClass).not.toBe("");
    }
  });

  it("applies the ADR-0007 projection", () => {
    expect(jobStatusPresentation("INTERVIEW").status).toBe("APPLIED");
    expect(jobStatusPresentation("OFFER").status).toBe("APPLIED");
    expect(jobStatusPresentation("ACCEPTED").status).toBe("APPLIED");
    expect(jobStatusPresentation("WITHDRAWN").status).toBe("REJECTED");
  });

  it("falls back to NEW for a value the enum does not contain", () => {
    expect(jobStatusPresentation("SOMETHING_ELSE").status).toBe("NEW");
  });

  it("gives one Job the same status in a list row and a detail header", () => {
    // These were separate maps that disagreed: APPLIED was sky blue in the row
    // and a different colour in the header; REJECTED was rose in one and
    // neutral grey in the other.
    for (const stored of JOB_STATUS_VALUES) {
      const presentation = jobStatusPresentation(stored);
      const family = (klass: string) =>
        klass.match(/\b(emerald|sky|rose)\b/)?.[1] ?? null;
      expect(family(presentation.badgeClass)).toBe(family(presentation.headerClass));
      expect(family(presentation.badgeClass)).not.toBeNull();
    }
  });
});
