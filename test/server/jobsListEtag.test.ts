import { describe, expect, it } from "vitest";
import { buildJobsListEtag } from "@/lib/server/jobsListEtag";

describe("buildJobsListEtag", () => {
  it("stays stable for identical payload", () => {
    const tagA = buildJobsListEtag({
      userId: "user-1",
      cursor: null,
      nextCursor: null,
      filtersSignature: "q=frontend|status=ALL|sort=newest|limit=10",
      items: [
        {
          id: "job-1",
          status: "NEW",
          updatedAt: "2026-02-11T12:00:00.000Z",
          resumePdfUrl: null,
          resumePdfName: null,
        },
        {
          id: "job-2",
          status: "APPLIED",
          updatedAt: "2026-02-11T12:01:00.000Z",
          resumePdfUrl: "https://blob.example/job-2.pdf",
          resumePdfName: "job-2.pdf",
        },
      ],
    });

    const tagB = buildJobsListEtag({
      userId: "user-1",
      cursor: null,
      nextCursor: null,
      filtersSignature: "q=frontend|status=ALL|sort=newest|limit=10",
      items: [
        {
          id: "job-1",
          status: "NEW",
          updatedAt: "2026-02-11T12:00:00.000Z",
          resumePdfUrl: null,
          resumePdfName: null,
        },
        {
          id: "job-2",
          status: "APPLIED",
          updatedAt: "2026-02-11T12:01:00.000Z",
          resumePdfUrl: "https://blob.example/job-2.pdf",
          resumePdfName: "job-2.pdf",
        },
      ],
    });

    expect(tagA).toBe(tagB);
  });

  it("changes when a non-first item status changes", () => {
    const before = buildJobsListEtag({
      userId: "user-1",
      cursor: null,
      nextCursor: null,
      filtersSignature: "q=frontend|status=ALL|sort=newest|limit=10",
      items: [
        {
          id: "job-1",
          status: "NEW",
          updatedAt: "2026-02-11T12:00:00.000Z",
          resumePdfUrl: null,
          resumePdfName: null,
        },
        {
          id: "job-2",
          status: "NEW",
          updatedAt: "2026-02-11T12:01:00.000Z",
          resumePdfUrl: null,
          resumePdfName: null,
        },
      ],
    });

    const after = buildJobsListEtag({
      userId: "user-1",
      cursor: null,
      nextCursor: null,
      filtersSignature: "q=frontend|status=ALL|sort=newest|limit=10",
      items: [
        {
          id: "job-1",
          status: "NEW",
          updatedAt: "2026-02-11T12:00:00.000Z",
          resumePdfUrl: null,
          resumePdfName: null,
        },
        {
          id: "job-2",
          status: "APPLIED",
          updatedAt: "2026-02-11T12:01:00.000Z",
          resumePdfUrl: null,
          resumePdfName: null,
        },
      ],
    });

    expect(after).not.toBe(before);
  });

  it("changes when cover pdf url changes", () => {
    const before = buildJobsListEtag({
      userId: "user-1",
      cursor: null,
      nextCursor: null,
      filtersSignature: "q=frontend|status=ALL|sort=newest|limit=10",
      items: [
        {
          id: "job-1",
          status: "APPLIED",
          updatedAt: "2026-02-11T12:00:00.000Z",
          resumePdfUrl: "https://blob.example/job-1-resume.pdf",
          resumePdfName: "job-1-resume.pdf",
          coverPdfUrl: null,
        },
      ],
    });

    const after = buildJobsListEtag({
      userId: "user-1",
      cursor: null,
      nextCursor: null,
      filtersSignature: "q=frontend|status=ALL|sort=newest|limit=10",
      items: [
        {
          id: "job-1",
          status: "APPLIED",
          updatedAt: "2026-02-11T12:00:00.000Z",
          resumePdfUrl: "https://blob.example/job-1-resume.pdf",
          resumePdfName: "job-1-resume.pdf",
          coverPdfUrl: "https://blob.example/job-1-cover.pdf",
        },
      ],
    });

    expect(after).not.toBe(before);
  });
});
