import { describe, expect, it } from "vitest";
import { scorePostingRisk } from "./postingRisk";

describe("scorePostingRisk", () => {
  it("scores a normal aggregator posting as clean", () => {
    const result = scorePostingRisk({
      jobUrl: "https://www.linkedin.com/jobs/view/123456",
      company: "Acme Robotics",
    });

    expect(result).toEqual({ score: 0, flags: [], band: "low" });
  });

  it("does not flag a company/host mismatch on a known job board", () => {
    // Every row Joblit ingests arrives on an aggregator or ATS host, never the
    // employer's own domain. Without the allowlist this rule would fire on
    // literally every job and carry no signal at all.
    for (const jobUrl of [
      "https://www.linkedin.com/jobs/view/1",
      "https://remoteok.com/remote-jobs/2",
      "https://remotive.com/remote-jobs/dev/3",
      "https://jobicy.com/jobs/4",
      "https://www.seek.com.au/job/5",
      "https://www.nowcoder.com/job/6",
      "https://boards.greenhouse.io/acme/jobs/7",
      "https://jobs.lever.co/acme/8",
      "https://jobs.ashbyhq.com/acme/9",
    ]) {
      const result = scorePostingRisk({ jobUrl, company: "Totally Unrelated" });
      expect(result.flags).toEqual([]);
    }
  });

  it("flags an unparseable or non-http url", () => {
    for (const jobUrl of ["not-a-url", "ftp://example.com/job", ""]) {
      const result = scorePostingRisk({ jobUrl, company: "Acme" });
      expect(result.flags).toContain("invalid_url");
      expect(result.score).toBe(50);
      expect(result.band).toBe("high");
    }
  });

  it("flags a link-shortener host", () => {
    const result = scorePostingRisk({
      jobUrl: "https://bit.ly/abc123",
      company: "Acme",
    });

    expect(result.flags).toContain("suspicious_domain");
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it("flags a subdomain of a shortener host", () => {
    const result = scorePostingRisk({
      jobUrl: "https://links.bit.ly/abc123",
      company: "Acme",
    });

    expect(result.flags).toContain("suspicious_domain");
  });

  it("does not treat a lookalike host as a shortener", () => {
    // "evil-bit.ly" must not match a "bit.ly" entry; suffix matching is
    // anchored on a dot.
    const result = scorePostingRisk({
      jobUrl: "https://evil-bit.ly.example.com/job",
      company: "Example",
    });

    expect(result.flags).not.toContain("suspicious_domain");
  });

  it("flags a company that does not appear in a self-hosted url", () => {
    const result = scorePostingRisk({
      jobUrl: "https://careers.someagency.io/listing/42",
      company: "Acme Robotics",
    });

    expect(result.flags).toContain("company_domain_mismatch");
    expect(result.score).toBe(15);
    expect(result.band).toBe("low");
  });

  it("accepts a self-hosted url that carries the company name", () => {
    const result = scorePostingRisk({
      jobUrl: "https://careers.acmerobotics.io/listing/42",
      company: "Acme Robotics",
    });

    expect(result.flags).toEqual([]);
  });

  it("accepts a single significant word of the company name", () => {
    const result = scorePostingRisk({
      jobUrl: "https://jobs.canva.com/listing/42",
      company: "Canva Pty Ltd",
    });

    expect(result.flags).toEqual([]);
  });

  it("cannot evaluate a mismatch without a company, so raises nothing", () => {
    for (const company of [null, "", "   "]) {
      const result = scorePostingRisk({
        jobUrl: "https://careers.someagency.io/listing/42",
        company,
      });
      expect(result.flags).toEqual([]);
    }
  });

  it("accumulates penalties and clamps the score to 100", () => {
    const result = scorePostingRisk({
      jobUrl: "https://tinyurl.com/xyz",
      company: "Acme Robotics",
    });

    // suspicious_domain (25) + company_domain_mismatch (15)
    expect(result.flags).toEqual([
      "suspicious_domain",
      "company_domain_mismatch",
    ]);
    expect(result.score).toBe(40);
    expect(result.band).toBe("medium");
  });

  it("stops after an invalid url instead of guessing at a hostname", () => {
    const result = scorePostingRisk({ jobUrl: "://broken", company: "Acme" });

    expect(result.flags).toEqual(["invalid_url"]);
  });

  it("bands by score", () => {
    expect(scorePostingRisk({ jobUrl: "https://www.linkedin.com/jobs/view/1", company: "Acme" }).band).toBe("low");
    expect(scorePostingRisk({ jobUrl: "https://careers.other.io/1", company: "Acme" }).band).toBe("low");
    expect(scorePostingRisk({ jobUrl: "https://bit.ly/1", company: "Acme" }).band).toBe("medium");
    expect(scorePostingRisk({ jobUrl: "bad", company: "Acme" }).band).toBe("high");
  });
});
