import { describe, expect, it } from "vitest";
import { isJobApplicationContext } from "./jobContext";

describe("isJobApplicationContext", () => {
  it.each([
    "greenhouse.io",
    "lever.co",
    "myworkdayjobs.com",
    "icims.com",
    "successfactors.com",
    "taleo.net",
    "smartrecruiters.com",
    "jobvite.com",
    "ashbyhq.com",
    "seek.com",
  ])("recognizes the supported ATS host suffix %s", (host) => {
    expect(isJobApplicationContext(`https://boards.${host}/company`)).toBe(true);
  });

  it.each([
    "https://company.workday.com/en-US/job/12345",
    "https://company.bamboohr.com/careers/12345",
    "https://ats.rippling.com/acme/jobs/12345",
  ])("recognizes a contextual ATS job path: %s", (url) => {
    expect(isJobApplicationContext(url)).toBe(true);
  });

  it.each([
    "https://www.workday.com/",
    "https://app.bamboohr.com/login",
    "https://app.rippling.com/",
  ])("rejects a non-recruiting page on a shared ATS domain: %s", (url) => {
    expect(isJobApplicationContext(url)).toBe(false);
  });

  it("recognizes an exact job-path segment on a custom recruiting site", () => {
    expect(isJobApplicationContext("https://careers.example.com/jobs/123")).toBe(true);
  });

  it("does not treat query-string keywords or partial path tokens as job context", () => {
    expect(
      isJobApplicationContext(
        "https://bank.example.com/login?next=/careers/jobs/123",
      ),
    ).toBe(false);
    expect(isJobApplicationContext("https://example.com/job-search")).toBe(false);
  });

  it("does not accept a lookalike ATS hostname", () => {
    expect(isJobApplicationContext("https://notgreenhouse.io/company")).toBe(false);
  });

  it("returns false for an invalid URL", () => {
    expect(isJobApplicationContext("not a url")).toBe(false);
  });
});
