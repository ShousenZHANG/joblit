import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { JobItem, JobsResponse } from "../types";
import {
  buildInitialJobsInfiniteData,
  getJobsListQueryKey,
  patchGeneratedJobArtifactInJobsCache,
  patchJobStatusInJobsCache,
  removeJobFromJobsCache,
  removeJobsFromJobsCache,
  restoreJobsSnapshots,
  type JobsInfiniteData,
} from "./jobsQueryCache";

const baseJob: JobItem = {
  id: "11111111-1111-1111-1111-111111111111",
  jobUrl: "https://example.com/job/1",
  title: "Frontend Engineer",
  company: "Acme",
  location: "Remote",
  jobType: "Full-time",
  jobLevel: "Mid",
  status: "NEW",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const appliedOnlyJob = {
  ...baseJob,
  id: "22222222-2222-2222-2222-222222222222",
  status: "APPLIED" as const,
};

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

// Build an InfiniteData payload from one or more page responses. The first
// page param is always null (the first page is fetched with no cursor).
function infinite(...pages: JobsResponse[]): JobsInfiniteData {
  return {
    pages,
    pageParams: pages.map((_, index) => (index === 0 ? null : `cursor-${index}`)),
  };
}

describe("jobs query cache helpers", () => {
  it("builds initial infinite data with job-level facets from the current payload", () => {
    expect(
      buildInitialJobsInfiniteData({
        initialItems: [baseJob, { ...baseJob, id: "2", jobLevel: "Senior" }],
        initialCursor: null,
      }),
    ).toMatchObject({
      pages: [
        {
          items: [baseJob, { ...baseJob, id: "2", jobLevel: "Senior" }],
          nextCursor: null,
          facets: { jobLevels: ["Mid", "Senior"] },
        },
      ],
      pageParams: [null],
    });
  });

  it("drops a row from the status view it no longer matches, and rolls back", () => {
    // No "all statuses" view exists — each cache is one status view. Moving a
    // job NEW→APPLIED removes it from the NEW view (and decrements), while the
    // APPLIED view (holding a different job) stays untouched.
    const client = createClient();
    const newKey = getJobsListQueryKey("status=NEW");
    const appliedKey = getJobsListQueryKey("status=APPLIED");

    client.setQueryData<JobsInfiniteData>(
      newKey,
      infinite({ items: [baseJob], nextCursor: null, totalCount: 1 }),
    );
    client.setQueryData<JobsInfiniteData>(
      appliedKey,
      infinite({ items: [appliedOnlyJob], nextCursor: null, totalCount: 5 }),
    );

    const snapshots = patchJobStatusInJobsCache(client, baseJob.id, "APPLIED");

    expect(client.getQueryData<JobsInfiniteData>(newKey)?.pages[0]).toMatchObject({
      items: [],
      totalCount: 0,
    });
    expect(client.getQueryData<JobsInfiniteData>(appliedKey)?.pages[0]).toMatchObject({
      items: [appliedOnlyJob],
      totalCount: 5,
    });

    restoreJobsSnapshots(client, snapshots);

    expect(client.getQueryData<JobsInfiniteData>(newKey)?.pages[0]).toMatchObject({
      items: [baseJob],
      totalCount: 1,
    });
  });

  it("removes selected ids without decrementing unrelated cached queries", () => {
    const client = createClient();
    const allKey = getJobsListQueryKey("status=NEW");
    const appliedKey = getJobsListQueryKey("status=APPLIED");

    client.setQueryData<JobsInfiniteData>(
      allKey,
      infinite({ items: [baseJob, appliedOnlyJob], nextCursor: null, totalCount: 2 }),
    );
    client.setQueryData<JobsInfiniteData>(
      appliedKey,
      infinite({ items: [appliedOnlyJob], nextCursor: null, totalCount: 5 }),
    );

    const snapshots = removeJobsFromJobsCache(client, new Set([baseJob.id]));

    expect(client.getQueryData<JobsInfiniteData>(allKey)?.pages[0]).toMatchObject({
      items: [appliedOnlyJob],
      totalCount: 1,
    });
    expect(client.getQueryData<JobsInfiniteData>(appliedKey)?.pages[0]).toMatchObject({
      items: [appliedOnlyJob],
      totalCount: 5,
    });

    restoreJobsSnapshots(client, snapshots);

    expect(client.getQueryData<JobsInfiniteData>(allKey)?.pages[0]).toMatchObject({
      items: [baseJob, appliedOnlyJob],
      totalCount: 2,
    });
  });

  it("removes a job from whichever page holds it and decrements page-0 totalCount", () => {
    const client = createClient();
    const allKey = getJobsListQueryKey("status=NEW");
    const page2Job = { ...baseJob, id: "33333333-3333-3333-3333-333333333333" };

    client.setQueryData<JobsInfiniteData>(
      allKey,
      infinite(
        { items: [baseJob], nextCursor: "cursor-1", totalCount: 2 },
        { items: [page2Job], nextCursor: null },
      ),
    );

    const snapshots = removeJobFromJobsCache(client, page2Job.id);

    const data = client.getQueryData<JobsInfiniteData>(allKey);
    expect(data?.pages[0]).toMatchObject({ items: [baseJob], totalCount: 1 });
    expect(data?.pages[1]?.items).toEqual([]);

    restoreJobsSnapshots(client, snapshots);

    const restored = client.getQueryData<JobsInfiniteData>(allKey);
    expect(restored?.pages[0]?.totalCount).toBe(2);
    expect(restored?.pages[1]?.items).toEqual([page2Job]);
  });

  it("patches generated artifact metadata across every cached jobs page", () => {
    const client = createClient();
    const allKey = getJobsListQueryKey("status=REJECTED");
    const newKey = getJobsListQueryKey("status=NEW");
    client.setQueryData<JobsInfiniteData>(
      allKey,
      infinite({ items: [baseJob], nextCursor: "cursor-1", totalCount: 1 }),
    );
    client.setQueryData<JobsInfiniteData>(
      newKey,
      infinite({ items: [baseJob], nextCursor: null, totalCount: 1 }),
    );

    patchGeneratedJobArtifactInJobsCache({
      queryClient: client,
      id: baseJob.id,
      patch: {
        resumePdfUrl: "blob:https://example.com/resume.pdf",
        resumePdfName: "resume.pdf",
      },
    });

    for (const key of [allKey, newKey]) {
      expect(client.getQueryData<JobsInfiniteData>(key)?.pages[0]?.items[0]).toMatchObject({
        resumePdfUrl: "blob:https://example.com/resume.pdf",
        resumePdfName: "resume.pdf",
      });
    }
  });
});
