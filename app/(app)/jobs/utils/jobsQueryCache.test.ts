import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { JobItem, JobsResponse } from "../types";
import {
  buildInitialJobsPageData,
  getJobsPageQueryKey,
  hydrateInitialJobsPage,
  patchGeneratedJobArtifactInJobsCache,
  patchJobStatusInJobsCache,
  removeJobsFromJobsCache,
  restoreJobsPatches,
  restoreJobsSnapshots,
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

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

describe("jobs query cache helpers", () => {
  it("hydrates the first jobs page from SSR data and keeps existing facets stable", () => {
    const client = createClient();
    const key = getJobsPageQueryKey("status=ALL", null);
    client.setQueryData<JobsResponse>(key, {
      items: [{ ...baseJob, id: "old", title: "Old cache" }],
      nextCursor: null,
      totalCount: 99,
      facets: { jobLevels: ["Senior"] },
    });

    hydrateInitialJobsPage({
      queryClient: client,
      queryString: "status=ALL",
      initialItems: [baseJob],
      initialCursor: "next",
    });

    expect(client.getQueryData<JobsResponse>(key)).toMatchObject({
      items: [baseJob],
      nextCursor: "next",
      totalCount: 99,
      facets: { jobLevels: ["Senior"] },
    });
  });

  it("builds initial page data with job-level facets from the current payload", () => {
    expect(
      buildInitialJobsPageData({
        initialItems: [baseJob, { ...baseJob, id: "2", jobLevel: "Senior" }],
        initialCursor: null,
      }),
    ).toMatchObject({
      items: [baseJob, { ...baseJob, id: "2", jobLevel: "Senior" }],
      nextCursor: null,
      facets: { jobLevels: ["Mid", "Senior"] },
    });
  });

  it("patches status-filtered caches and rolls back the exact touched queries", () => {
    const client = createClient();
    const allKey = getJobsPageQueryKey("status=ALL", null);
    const newKey = getJobsPageQueryKey("status=NEW", null);
    const appliedKey = getJobsPageQueryKey("status=APPLIED", null);
    const appliedOnlyJob = { ...baseJob, id: "22222222-2222-2222-2222-222222222222", status: "APPLIED" as const };

    client.setQueryData<JobsResponse>(allKey, {
      items: [baseJob],
      nextCursor: null,
      totalCount: 1,
    });
    client.setQueryData<JobsResponse>(newKey, {
      items: [baseJob],
      nextCursor: null,
      totalCount: 1,
    });
    client.setQueryData<JobsResponse>(appliedKey, {
      items: [appliedOnlyJob],
      nextCursor: null,
      totalCount: 5,
    });

    const patches = patchJobStatusInJobsCache(client, baseJob.id, "APPLIED");

    expect(client.getQueryData<JobsResponse>(allKey)?.items[0]?.status).toBe("APPLIED");
    expect(client.getQueryData<JobsResponse>(newKey)).toMatchObject({
      items: [],
      totalCount: 0,
    });
    expect(client.getQueryData<JobsResponse>(appliedKey)).toMatchObject({
      items: [appliedOnlyJob],
      totalCount: 5,
    });

    restoreJobsPatches(client, patches);

    expect(client.getQueryData<JobsResponse>(allKey)).toMatchObject({
      items: [baseJob],
      totalCount: 1,
    });
    expect(client.getQueryData<JobsResponse>(newKey)).toMatchObject({
      items: [baseJob],
      totalCount: 1,
    });
  });

  it("removes selected ids without decrementing unrelated cached queries", () => {
    const client = createClient();
    const allKey = getJobsPageQueryKey("status=ALL", null);
    const appliedKey = getJobsPageQueryKey("status=APPLIED", null);
    const appliedOnlyJob = { ...baseJob, id: "22222222-2222-2222-2222-222222222222", status: "APPLIED" as const };

    client.setQueryData<JobsResponse>(allKey, {
      items: [baseJob, appliedOnlyJob],
      nextCursor: null,
      totalCount: 2,
    });
    client.setQueryData<JobsResponse>(appliedKey, {
      items: [appliedOnlyJob],
      nextCursor: null,
      totalCount: 5,
    });

    const snapshots = removeJobsFromJobsCache(client, new Set([baseJob.id]));

    expect(client.getQueryData<JobsResponse>(allKey)).toMatchObject({
      items: [appliedOnlyJob],
      totalCount: 1,
    });
    expect(client.getQueryData<JobsResponse>(appliedKey)).toMatchObject({
      items: [appliedOnlyJob],
      totalCount: 5,
    });

    restoreJobsSnapshots(client, snapshots);

    expect(client.getQueryData<JobsResponse>(allKey)).toMatchObject({
      items: [baseJob, appliedOnlyJob],
      totalCount: 2,
    });
  });

  it("patches generated artifact metadata across every cached jobs page", () => {
    const client = createClient();
    const allKey = getJobsPageQueryKey("status=ALL", null);
    const newKey = getJobsPageQueryKey("status=NEW", "cursor-1");
    client.setQueryData<JobsResponse>(allKey, {
      items: [baseJob],
      nextCursor: "cursor-1",
      totalCount: 1,
    });
    client.setQueryData<JobsResponse>(newKey, {
      items: [baseJob],
      nextCursor: null,
      totalCount: 1,
    });

    patchGeneratedJobArtifactInJobsCache({
      queryClient: client,
      id: baseJob.id,
      patch: {
        resumePdfUrl: "blob:https://example.com/resume.pdf",
        resumePdfName: "resume.pdf",
      },
    });

    for (const key of [allKey, newKey]) {
      expect(client.getQueryData<JobsResponse>(key)?.items[0]).toMatchObject({
        resumePdfUrl: "blob:https://example.com/resume.pdf",
        resumePdfName: "resume.pdf",
      });
    }
  });
});
