import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/net/safeFetch", () => ({
  safeOutboundFetch: (
    url: string | URL,
    init?: RequestInit,
  ) => fetch(url, { ...init, redirect: "manual" }),
}));

import {
  extractSeekJobId,
  isSeekJobUrl,
  shouldEnrichSeekDescription,
  fetchSeekJobDescription,
  SEEK_THIN_DESCRIPTION,
} from "@/lib/server/seek/fetchJobDescription";

function gqlResponse(content: unknown) {
  return { ok: true, json: async () => ({ data: { jobDetails: { job: { content } } } }) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("seek job-url helpers", () => {
  it("extracts numeric ids only from au.seek.com/job/<id>", () => {
    expect(extractSeekJobId("https://au.seek.com/job/92521602")).toBe("92521602");
    expect(extractSeekJobId("https://au.seek.com/job/abc")).toBeNull();
    expect(extractSeekJobId("https://evil.com/job/1")).toBeNull();
    expect(extractSeekJobId("https://au.seek.com/jobs")).toBeNull();
    expect(isSeekJobUrl("https://au.seek.com/job/1")).toBe(true);
    expect(isSeekJobUrl("https://www.linkedin.com/jobs/view/1")).toBe(false);
  });

  it("flags only thin Seek descriptions for enrichment", () => {
    expect(shouldEnrichSeekDescription("https://au.seek.com/job/1", "short teaser")).toBe(true);
    expect(
      shouldEnrichSeekDescription("https://au.seek.com/job/1", "x".repeat(SEEK_THIN_DESCRIPTION + 1)),
    ).toBe(false);
    expect(shouldEnrichSeekDescription("https://www.linkedin.com/jobs/view/1", "short")).toBe(false);
  });
});

describe("fetchSeekJobDescription", () => {
  it("returns null and does not fetch when the kill-switch is off", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchSeekJobDescription("https://au.seek.com/job/1")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null and does not fetch for a non-Seek url (SSRF guard)", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "true");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchSeekJobDescription("https://evil.com/job/1")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("fetches and strips the full JD html to text via the numeric id", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "true");
    const f = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      gqlResponse(
        "<p><strong>AI Engineer</strong></p><ul><li>Build scalable platforms</li>" +
          "<li>Ship reliable services to production</li></ul>",
      ),
    );
    vi.stubGlobal("fetch", f);
    const out = await fetchSeekJobDescription("https://au.seek.com/job/92521602");
    expect(out).toContain("AI Engineer");
    expect(out).toContain("Build scalable platforms");
    expect(out).not.toContain("<");
    const body = JSON.parse(f.mock.calls[0]?.[1]?.body as string);
    expect(body.query).toContain('jobDetails(id: "92521602")');
  });

  it("returns null on missing content / non-ok / thrown error", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "true");

    vi.stubGlobal("fetch", vi.fn(async () => gqlResponse(null)));
    expect(await fetchSeekJobDescription("https://au.seek.com/job/1")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchSeekJobDescription("https://au.seek.com/job/1")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    expect(await fetchSeekJobDescription("https://au.seek.com/job/1")).toBeNull();
  });
});
