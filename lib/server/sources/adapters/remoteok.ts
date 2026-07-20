import type { RawSourceJob, SourceAdapter, SourceContext } from "../types";
import { httpsUrl, isoDate, salaryRange, stripHtml, text } from "./normalize";

// RemoteOK's public board feed. The response is a JSON array whose FIRST
// element is a {legal, last_updated} metadata object rather than a job — every
// consumer has to skip it. Everything on this board is remote by definition,
// so workArrangement is a constant rather than a parsed field.

const FEED_URL = "https://remoteok.com/api";
const ALLOWED_HOSTS = ["remoteok.com"] as const;

const adapter: SourceAdapter = {
  id: "remoteok",
  allowedHosts: ALLOWED_HOSTS,

  async fetch(ctx: SourceContext): Promise<RawSourceJob[]> {
    const payload = await ctx.fetchJson(FEED_URL, ALLOWED_HOSTS);
    if (!Array.isArray(payload)) {
      throw new Error("remoteok: expected a JSON array");
    }

    const jobs: RawSourceJob[] = [];
    for (const entry of payload) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      // The metadata head carries `legal` and no position — skip it.
      if (typeof row.position !== "string") continue;

      const title = text(row.position);
      const jobUrl = httpsUrl(row.url);
      if (!title || !jobUrl) continue;

      jobs.push({
        jobUrl,
        title,
        company: text(row.company),
        location: text(row.location),
        jobType: null,
        jobLevel: null,
        description: stripHtml(row.description),
        salary: salaryRange(row.salary_min, row.salary_max),
        workArrangement: "Remote",
        listingDate: isoDate(row.date),
        source: "remoteok",
      });
    }
    return jobs;
  },
};

export default adapter;
