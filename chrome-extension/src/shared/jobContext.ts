const ATS_HOST_SUFFIXES = [
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "workday.com",
  "icims.com",
  "successfactors.com",
  "taleo.net",
  "smartrecruiters.com",
  "bamboohr.com",
  "jobvite.com",
  "ashbyhq.com",
  "rippling.com",
  "seek.com",
] as const;

const JOB_PATH_SEGMENTS = new Set([
  "careers",
  "career",
  "jobs",
  "job",
  "apply",
  "application",
  "positions",
  "position",
  "vacancies",
  "vacancy",
  "openings",
  "opening",
]);

function hasHostSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/** Return whether a page is safe for automatic job-application initialization. */
export function isJobApplicationContext(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (ATS_HOST_SUFFIXES.some((suffix) => hasHostSuffix(hostname, suffix))) {
      return true;
    }

    return parsed.pathname
      .split("/")
      .filter(Boolean)
      .some((segment) =>
        JOB_PATH_SEGMENTS.has(decodeURIComponent(segment).toLowerCase()),
      );
  } catch {
    return false;
  }
}
