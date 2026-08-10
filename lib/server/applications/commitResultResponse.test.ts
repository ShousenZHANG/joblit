import { describe, expect, it, vi } from "vitest";

const reportErrorMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: reportErrorMock,
}));

// The mapper imports one shared constant from the commit module, which drags
// in Prisma and the Blob SDK behind it. Neither is exercised here, and the
// Blob SDK pulls undici, whose Response needs streams jsdom does not expose.
vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));
vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  del: vi.fn(),
  list: vi.fn(),
}));

import { commitRejectionResponse } from "./commitResultResponse";
import type { CommitResult } from "./commitApplicationArtifact";

type Rejection = Exclude<CommitResult, { kind: "committed" }>;

const CONTEXT = {
  requestId: "req-1",
  scope: "applications.manual-generate.draft",
  userId: "user-1",
  jobId: "job-1",
  target: "cover",
};

/**
 * Every rejection the commit path can produce. Adding a kind to CommitResult
 * without adding it here fails to compile, which is the point: an unmapped
 * kind is what took generation down.
 */
const REJECTIONS: Rejection[] = [
  { kind: "stale_write" },
  { kind: "stale_render_context" },
  { kind: "job_missing" },
  { kind: "invalid_ai_content" },
  { kind: "review_blocked", review: { grounded: false } as never },
  { kind: "blob_not_configured" },
  { kind: "upload_failed", cause: new Error("blob down") },
];

/**
 * The status code IS the contract with the Runner: it replays a receipt on 5xx
 * and stops on 4xx. A deterministic rejection answered as 5xx therefore gets
 * retried three times, deferred, and leaves its task lease held — the stall
 * that took production down. These tests pin the classification, not the
 * prose.
 */
describe("commitRejectionResponse", () => {
  it("answers a permanently-rejected commit as 4xx, never as unknown", async () => {
    // The two 5xx kinds are infrastructure, not verdicts: storage being
    // unconfigured or an upload failing genuinely may succeed on a later
    // attempt, so deferring is correct for them. Everything else is a decision
    // the server has already made — answering it 5xx is what made the Runner
    // replay a settled verdict and stall the queue.
    const permanent = REJECTIONS.filter(
      (result) =>
        result.kind !== "upload_failed" && result.kind !== "blob_not_configured",
    );
    expect(permanent).toHaveLength(5);

    for (const result of permanent) {
      const response = commitRejectionResponse(result, CONTEXT);
      expect(
        response.status,
        `${result.kind} must not read as an unknown settlement`,
      ).toBeLessThan(500);
      const body = await response.json();
      expect(body.error.code, `${result.kind} needs a code`).toBeTruthy();
      expect(body.requestId).toBe("req-1");
    }
  });

  it("keeps upload_failed retryable and reported", async () => {
    reportErrorMock.mockClear();
    const response = commitRejectionResponse(
      { kind: "upload_failed", cause: new Error("blob down") },
      CONTEXT,
    );

    expect(response.status).toBe(500);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0][1]).toMatchObject({
      scope: "applications.manual-generate.draft.blob-upload",
      userId: "user-1",
    });
  });

  it("never answers a rejection without an error code", async () => {
    for (const result of REJECTIONS) {
      const body = await commitRejectionResponse(result, CONTEXT).json();
      expect(body.error?.code, `${result.kind}`).toEqual(expect.any(String));
    }
  });

  it("reports an unmapped kind instead of answering it in silence", async () => {
    reportErrorMock.mockClear();
    // Simulates a kind added to the union with no mapping — the exact shape of
    // the original bug, where the answer was a bare 500 nobody could trace.
    const response = commitRejectionResponse(
      { kind: "something_new" } as unknown as Rejection,
      CONTEXT,
    );

    expect(response.status).toBe(500);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0][1]).toMatchObject({
      scope: "applications.manual-generate.draft.unmapped-commit-kind",
    });
  });
});
