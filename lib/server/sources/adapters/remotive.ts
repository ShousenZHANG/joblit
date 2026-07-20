import type { RawSourceJob, SourceAdapter, SourceContext } from "../types";
import { httpsUrl, isoDate, stripHtml, text } from "./normalize";

// Remotive's public API wraps its rows in a {"job-count", "jobs"} envelope.
// Publication dates arrive without a zone designator; they are UTC per the
// API docs, so they are parsed as such rather than as server-local time.

const FEED_URL = "https://remotive.com/api/remote-jobs";
const ALLOWED_HOSTS = ["remotive.com"] as const;

const adapter: SourceAdapter = {
  id: "remotive",
  allowedHosts: ALLOWED_HOSTS,

  async fetch(ctx: SourceContext): Promise<RawSourceJob[]> {
    const payload = await ctx.fetchJson(FEED_URL, ALLOWED_HOSTS);
    const rows =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).jobs
        : null;
    if (!Array.isArray(rows)) {
      throw new Error("remotive: expected a jobs array");
    }

    const jobs: RawSourceJob[] = [];
    for (const entry of rows) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const title = text(row.title);
      const jobUrl = httpsUrl(row.url);
      if (!title || !jobUrl) continue;

      jobs.push({
        jobUrl,
        title,
        company: text(row.company_name),
        location: text(row.candidate_required_location),
        jobType: text(row.job_type),
        jobLevel: null,
        description: stripHtml(row.description),
        salary: text(row.salary),
        workArrangement: "Remote",
        listingDate: isoDate(row.publication_date, true),
        source: "remotive",
      });
    }
    return jobs;
  },
};

export default adapter;
