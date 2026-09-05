import { describe, expect, it } from "vitest";
import { parseJobsUrlState, writeJobsUrlState } from "./jobsUrlState";

describe("jobsUrlState", () => {
  it("parses persisted filters, selection, and mobile view", () => {
    expect(
      parseJobsUrlState(
        new URLSearchParams(
          "q=react&status=APPLIED&job=j2&view=detail",
        ),
      ),
    ).toEqual({
      q: "react",
      statusFilter: "APPLIED",
      selectedId: "j2",
      view: "detail",
    });
  });

  it("falls back safely for unsupported status and view values", () => {
    expect(
      parseJobsUrlState(new URLSearchParams("status=broken&view=grid")),
    ).toEqual({
      q: "",
      statusFilter: "NEW",
      selectedId: null,
      view: "list",
    });
  });

  it("removes defaults while preserving unrelated query parameters", () => {
    expect(
      writeJobsUrlState(new URLSearchParams("utm=x"), {
        q: "",
        statusFilter: "NEW",
        selectedId: null,
        view: "list",
      }).toString(),
    ).toBe("utm=x");
  });

  it("updates only the patched jobs keys", () => {
    expect(
      writeJobsUrlState(
        new URLSearchParams(
          "utm=x&q=old&status=APPLIED&location=Remote&job=j1&view=detail",
        ),
        { q: "typescript", statusFilter: "REJECTED", selectedId: "j2" },
      ).toString(),
    ).toBe(
      "utm=x&q=typescript&status=REJECTED&location=Remote&job=j2&view=detail",
    );
  });
});
