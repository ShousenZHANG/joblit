import { describe, expect, it } from "vitest";
import { canonicalizeJobUrl } from "./canonicalizeJobUrl";

describe("canonicalizeJobUrl", () => {
  it("preserves a non-path job identity while dropping tracking parameters", () => {
    expect(
      canonicalizeJobUrl(
        "https://boards.greenhouse.io/acme/jobs?gh_jid=123&utm_source=linkedin",
      ),
    ).toBe("https://boards.greenhouse.io/acme/jobs?gh_jid=123");
  });

  it("does not collapse distinct query-identified jobs", () => {
    const first = canonicalizeJobUrl("https://careers.example.com/apply?jobId=100");
    const second = canonicalizeJobUrl("https://careers.example.com/apply?jobId=200");

    expect(first).not.toBe(second);
  });

  it("rejects non-HTTP URLs", () => {
    expect(canonicalizeJobUrl("ftp://example.com/jobs/123")).toBe("");
  });

  it("keeps the existing LinkedIn stable-ID normalization", () => {
    expect(
      canonicalizeJobUrl(
        "https://au.linkedin.com/jobs/search?currentJobId=999&utm_source=x",
      ),
    ).toBe("https://linkedin.com/jobs/view/999");
  });

  it("uses alias priority and RFC3986 encoding consistently with the worker", () => {
    expect(
      canonicalizeJobUrl(
        "https://careers.example.com/apply?jid=2&job_id=hello%20world%21%27%28%29%2A",
      ),
    ).toBe(
      "https://careers.example.com/apply?job_id=hello%20world%21%27%28%29%2A",
    );
  });
});
