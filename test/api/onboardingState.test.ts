import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The checklist must tell the truth.
 *
 * Completion used to be purely client-reported: markTaskComplete fired in the
 * browser when the user performed the action in that tab. A user who built
 * their resume before the guide shipped, or on another device, or whose tab
 * closed before the PATCH landed, saw a checklist claiming work they had done
 * was still to do — and a guide that points at a finished step once is a guide
 * the user learns to ignore.
 *
 * GET now infers completion from the rows the actions actually create, merges
 * it with whatever the client reported (union — never backwards), and persists
 * the result.
 */

const store = vi.hoisted(() => ({
  onboardingFindUnique: vi.fn(),
  onboardingCreate: vi.fn(),
  onboardingUpsert: vi.fn(),
  resumeProfileCount: vi.fn(),
  fetchRunCount: vi.fn(),
  applicationCount: vi.fn(),
  jobCount: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    onboardingState: {
      findUnique: store.onboardingFindUnique,
      create: store.onboardingCreate,
      upsert: store.onboardingUpsert,
    },
    resumeProfile: { count: store.resumeProfileCount },
    fetchRun: { count: store.fetchRunCount },
    application: { count: store.applicationCount },
    job: { count: store.jobCount },
  },
}));

vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/onboarding/state/route";

const FULL_CHECKLIST = {
  resume_setup: true,
  first_fetch: true,
  review_jobs: true,
  generate_first_pdf: true,
  mark_applied: true,
};

function signIn() {
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "user-1" },
  });
}

/** Counts for a user whose database contains the given artefacts. */
function seedData(input: {
  profiles?: number;
  fetchRuns?: number;
  applications?: number;
  actionedJobs?: number;
  appliedJobs?: number;
}) {
  store.resumeProfileCount.mockResolvedValue(input.profiles ?? 0);
  store.fetchRunCount.mockResolvedValue(input.fetchRuns ?? 0);
  store.applicationCount.mockResolvedValue(input.applications ?? 0);
  // job.count is called with different filters; tell them apart by the where
  // clause rather than by call order.
  store.jobCount.mockImplementation(async (args: { where?: { status?: unknown } }) => {
    const status = args?.where?.status as
      | { in?: string[]; not?: string }
      | undefined;
    if (status && "in" in status) return input.appliedJobs ?? 0;
    return input.actionedJobs ?? 0;
  });
}

beforeEach(() => {
  for (const mock of Object.values(store)) mock.mockReset();
  store.onboardingUpsert.mockImplementation(
    async (args: { create: Record<string, unknown> }) => ({
      stage: args.create.stage,
      checklist: args.create.checklist,
      dismissedAt: null,
      completedAt: (args.create.completedAt as Date | null) ?? null,
    }),
  );
  store.onboardingCreate.mockImplementation(
    async (args: { data: Record<string, unknown> }) => ({
      stage: args.data.stage,
      checklist: args.data.checklist,
      dismissedAt: null,
      completedAt: (args.data.completedAt as Date | null) ?? null,
    }),
  );
});

describe("GET /api/onboarding/state — inferred completion", () => {
  it("marks every task complete for an established user with no onboarding row", async () => {
    // The user who joined before the guide shipped: resume, fetches,
    // applications and applied jobs all exist, onboarding row does not.
    signIn();
    store.onboardingFindUnique.mockResolvedValue(null);
    seedData({
      profiles: 1,
      fetchRuns: 3,
      applications: 2,
      actionedJobs: 5,
      appliedJobs: 2,
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.state.checklist).toEqual(FULL_CHECKLIST);
    expect(json.state.isComplete).toBe(true);
    expect(json.state.stage).toBe("ACTIVATED_USER");
  });

  it("leaves a brand-new user untouched", async () => {
    signIn();
    store.onboardingFindUnique.mockResolvedValue(null);
    seedData({});

    const res = await GET();
    const json = await res.json();

    expect(json.state.checklist).toEqual({
      resume_setup: false,
      first_fetch: false,
      review_jobs: false,
      generate_first_pdf: false,
      mark_applied: false,
    });
    expect(json.state.stage).toBe("NEW_USER");
  });

  it("infers only what the data supports", async () => {
    signIn();
    store.onboardingFindUnique.mockResolvedValue(null);
    seedData({ profiles: 1 });

    const res = await GET();
    const json = await res.json();

    expect(json.state.checklist).toEqual({
      resume_setup: true,
      first_fetch: false,
      review_jobs: false,
      generate_first_pdf: false,
      mark_applied: false,
    });
  });

  it("infers review_jobs from an actioned job even without an application", async () => {
    // Changing any status off NEW can only be done from the list, so a
    // REJECTED job proves the list was reviewed.
    signIn();
    store.onboardingFindUnique.mockResolvedValue(null);
    seedData({ actionedJobs: 1 });

    const res = await GET();
    const json = await res.json();
    expect(json.state.checklist.review_jobs).toBe(true);
    expect(json.state.checklist.mark_applied).toBe(false);
  });

  it("counts a retired APPLIED-family status as applied", async () => {
    // ADR-0007: INTERVIEW/OFFER/ACCEPTED project onto APPLIED and still mean
    // the user applied.
    signIn();
    store.onboardingFindUnique.mockResolvedValue(null);
    seedData({ actionedJobs: 1, appliedJobs: 1 });

    const res = await GET();
    const json = await res.json();
    expect(json.state.checklist.mark_applied).toBe(true);
  });

  it("never un-completes a client-reported task the data cannot see", async () => {
    // review_jobs was reported by the browser; the database has no trace.
    // Union means it stays completed.
    signIn();
    store.onboardingFindUnique.mockResolvedValue({
      stage: "NEW_USER",
      checklist: { ...FULL_CHECKLIST, resume_setup: false },
      dismissedAt: null,
      completedAt: null,
    });
    seedData({ profiles: 1 });

    const res = await GET();
    const json = await res.json();
    expect(json.state.checklist).toEqual(FULL_CHECKLIST);
    expect(json.state.isComplete).toBe(true);
  });

  it("runs no data queries when the stored checklist is already complete", async () => {
    signIn();
    store.onboardingFindUnique.mockResolvedValue({
      stage: "ACTIVATED_USER",
      checklist: FULL_CHECKLIST,
      dismissedAt: null,
      completedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(store.resumeProfileCount).not.toHaveBeenCalled();
    expect(store.fetchRunCount).not.toHaveBeenCalled();
    expect(store.applicationCount).not.toHaveBeenCalled();
    expect(store.jobCount).not.toHaveBeenCalled();
  });

  it("persists what it inferred, so the next GET reads it back directly", async () => {
    signIn();
    store.onboardingFindUnique.mockResolvedValue(null);
    seedData({ profiles: 1, fetchRuns: 1 });

    await GET();

    const written =
      store.onboardingUpsert.mock.calls[0]?.[0] ??
      store.onboardingCreate.mock.calls[0]?.[0];
    expect(written).toBeTruthy();
    const checklist = (written.create ?? written.data).checklist as Record<
      string,
      boolean
    >;
    expect(checklist.resume_setup).toBe(true);
    expect(checklist.first_fetch).toBe(true);
  });
});
