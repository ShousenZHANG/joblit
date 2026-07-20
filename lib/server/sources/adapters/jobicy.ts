import type { RawSourceJob, SourceAdapter, SourceContext } from "../types";
import { httpsUrl, isoDate, salaryRange, stripHtml, text } from "./normalize";

// Jobicy's public v2 feed. Two shape quirks worth naming: jobType is an ARRAY
// (a posting can be both full-time and contract), and pubDate is a
// space-separated UTC datetime rather than an ISO string.

const FEED_URL = "https://jobicy.com/api/v2/remote-jobs?count=50";
const ALLOWED_HOSTS = ["jobicy.com"] as const;

function jobTypeLabel(value: unknown): string | null {
  if (!Array.isArray(value)) return text(value);
  const parts = value
    .map((entry) => text(entry))
    .filter((entry): entry is string => entry !== null);
  return parts.length ? parts.join(", ") : null;
}

const adapter: SourceAdapter = {
  id: "jobicy",
  allowedHosts: ALLOWED_HOSTS,

  async fetch(ctx: SourceContext): Promise<RawSourceJob[]> {
    const payload = await ctx.fetchJson(FEED_URL, ALLOWED_HOSTS);
    const rows =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).jobs
        : null;
    if (!Array.isArray(rows)) {
      throw new Error("jobicy: expected a jobs array");
    }

    const jobs: RawSourceJob[] = [];
    for (const entry of rows) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const title = text(row.jobTitle);
      const jobUrl = httpsUrl(row.url);
      if (!title || !jobUrl) continue;

      jobs.push({
        jobUrl,
        title,
        company: text(row.companyName),
        location: text(row.jobGeo),
        jobType: jobTypeLabel(row.jobType),
        jobLevel: text(row.jobLevel),
        description: stripHtml(row.jobExcerpt),
        salary: salaryRange(
          row.annualSalaryMin,
          row.annualSalaryMax,
          row.salaryCurrency,
        ),
        workArrangement: "Remote",
        listingDate: isoDate(row.pubDate, true),
        source: "jobicy",
      });
    }
    return jobs;
  },
};

export default adapter;
