import { describe, expect, it } from "vitest";
import {
  classifyJobLiveness,
  toPersistedJobLivenessStatus,
} from "@/lib/server/jobs/jobLiveness";

const REQUESTED =
  "https://boards.greenhouse.io/acme/jobs/123456?gh_jid=123456";

describe("job liveness", () => {
  it("marks reachable posting content active", () => {
    expect(
      classifyJobLiveness({
        requestedUrl: REQUESTED,
        finalUrl: REQUESTED,
        httpStatus: 200,
        bodyText: "Backend Engineer. Apply now.",
        checkedAt: "2026-07-20T00:00:00Z",
      }),
    ).toEqual({
      status: "active",
      reason: "reachable",
      checkedAt: "2026-07-20T00:00:00Z",
      httpStatus: 200,
    });
  });

  it("only treats explicit not-found and closed content as expired", () => {
    expect(
      classifyJobLiveness({ requestedUrl: REQUESTED, httpStatus: 404 }),
    ).toMatchObject({ status: "expired", reason: "http_not_found" });
    expect(
      classifyJobLiveness({
        requestedUrl: REQUESTED,
        httpStatus: 200,
        bodyText: "This job is no longer available.",
      }),
    ).toMatchObject({ status: "expired", reason: "expired_content" });
    expect(
      classifyJobLiveness({
        requestedUrl: REQUESTED,
        httpStatus: 200,
        bodyText: "该岗位已下线",
      }),
    ).toMatchObject({ status: "expired", reason: "expired_content" });
  });

  it("keeps access failures and challenge pages uncertain", () => {
    expect(
      classifyJobLiveness({ requestedUrl: REQUESTED, httpStatus: 403 }),
    ).toMatchObject({ status: "uncertain", reason: "access_denied" });
    expect(
      classifyJobLiveness({ requestedUrl: REQUESTED, httpStatus: 503 }),
    ).toMatchObject({ status: "uncertain", reason: "server_error" });
    expect(
      classifyJobLiveness({ requestedUrl: REQUESTED, httpStatus: 302 }),
    ).toMatchObject({ status: "uncertain", reason: "unexpected_status" });
    expect(
      classifyJobLiveness({
        requestedUrl: REQUESTED,
        httpStatus: 200,
        bodyText: "Checking your browser before accessing. Cloudflare Ray ID",
      }),
    ).toMatchObject({ status: "uncertain", reason: "challenge_page" });
    expect(
      classifyJobLiveness({
        requestedUrl: REQUESTED,
        httpStatus: 200,
        bodyText: "Sign in to continue",
      }),
    ).toMatchObject({ status: "uncertain", reason: "login_wall" });
  });

  it("detects redirects that lose the requested job identity", () => {
    expect(
      classifyJobLiveness({
        requestedUrl: REQUESTED,
        finalUrl: "https://boards.greenhouse.io/acme",
        httpStatus: 200,
        bodyText: "Other current openings",
      }),
    ).toMatchObject({ status: "uncertain", reason: "job_identity_lost" });
  });

  it("tracks common query and LinkedIn path job identities", () => {
    expect(
      classifyJobLiveness({
        requestedUrl:
          "https://www.linkedin.com/jobs/view/987654?trackingId=abc",
        finalUrl: "https://www.linkedin.com/jobs/search",
        httpStatus: 200,
      }),
    ).toMatchObject({ status: "uncertain", reason: "job_identity_lost" });
    expect(
      classifyJobLiveness({
        requestedUrl: "https://au.indeed.com/viewjob?jk=AbC123",
        finalUrl: "https://au.indeed.com/viewjob?jk=AbC123",
        httpStatus: 200,
      }),
    ).toMatchObject({ status: "active", reason: "reachable" });
  });

  it("keeps network failures uncertain", () => {
    expect(
      classifyJobLiveness({
        requestedUrl: REQUESTED,
        networkError: true,
      }),
    ).toMatchObject({ status: "uncertain", reason: "network_error" });
    expect(toPersistedJobLivenessStatus("uncertain")).toBe("UNCERTAIN");
  });

  it("treats a posting missing from a successful source feed as uncertain", () => {
    expect(
      classifyJobLiveness({
        requestedUrl: REQUESTED,
        seenInSourceFeed: false,
      }),
    ).toMatchObject({
      status: "uncertain",
      reason: "missing_from_source_feed",
    });
  });
});
