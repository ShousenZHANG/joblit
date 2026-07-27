import { describe, expect, it } from "vitest";
import {
  jobDetailResponseSchema,
  jobListItemSchema,
  jobsListResponseSchema,
} from "./jobsList";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    jobUrl: "https://example.com/jobs/1",
    title: "Platform Engineer",
    company: "Globex",
    location: "Sydney",
    jobType: null,
    jobLevel: null,
    status: "NEW",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("jobsListResponseSchema", () => {
  it("accepts a minimal row", () => {
    expect(jobListItemSchema.safeParse(row()).success).toBe(true);
  });

  it("accepts every retired status the database can still hold", () => {
    // ADR-0007 keeps all seven parseable; only three are offered.
    for (const status of ["INTERVIEW", "OFFER", "ACCEPTED", "WITHDRAWN"]) {
      expect(jobListItemSchema.safeParse(row({ status })).success).toBe(true);
    }
  });

  it("rejects a row with no id rather than rendering a card that cannot be opened", () => {
    const { id: _id, ...withoutId } = row();
    expect(jobListItemSchema.safeParse(withoutId).success).toBe(false);
  });

  it("rejects a status the projection does not know", () => {
    expect(jobListItemSchema.safeParse(row({ status: "ARCHIVED" })).success).toBe(
      false,
    );
  });

  it("rejects a numeric field arriving as a string", () => {
    expect(jobListItemSchema.safeParse(row({ fitScore: "72" })).success).toBe(
      false,
    );
  });

  it("strips unknown keys so a new server field does not break an old client", () => {
    const parsed = jobListItemSchema.parse(row({ somethingNew: "value" }));
    expect(parsed).not.toHaveProperty("somethingNew");
  });

  it("requires items and a cursor slot on the envelope", () => {
    expect(
      jobsListResponseSchema.safeParse({ items: [row()], nextCursor: null })
        .success,
    ).toBe(true);
    expect(jobsListResponseSchema.safeParse({ items: [row()] }).success).toBe(
      false,
    );
  });

  it("rejects an envelope whose items are not rows", () => {
    expect(
      jobsListResponseSchema.safeParse({ items: [{ nope: true }], nextCursor: null })
        .success,
    ).toBe(false);
  });

  it("carries the optional facets and total through", () => {
    const parsed = jobsListResponseSchema.parse({
      items: [],
      nextCursor: "cursor-1",
      totalCount: 42,
      facets: { jobLevels: ["Mid", "Senior"] },
    });
    expect(parsed.totalCount).toBe(42);
    expect(parsed.facets?.jobLevels).toEqual(["Mid", "Senior"]);
  });
});

describe("jobDetailResponseSchema", () => {
  it("accepts a detail with no fit matrix yet", () => {
    expect(
      jobDetailResponseSchema.safeParse({
        id: "job-1",
        description: "Build things.",
        fitMatrix: null,
        updatedAt: "2026-07-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("requires updatedAt — the list and detail use it to stay coherent", () => {
    expect(
      jobDetailResponseSchema.safeParse({
        id: "job-1",
        description: null,
        fitMatrix: null,
      }).success,
    ).toBe(false);
  });
});
