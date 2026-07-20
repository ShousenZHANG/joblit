import type { RawSourceJob, SourceAdapter, SourceContext } from "../types";
import type { AtsBoardConfig } from "../atsBoards";
import { httpsUrl, isoDate, salaryRange, stripHtml, text } from "./normalize";

interface AtsRequest {
  url: string;
  allowedHosts: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nestedText(
  value: unknown,
  ...path: string[]
): string | null {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return text(current);
}

function timestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return isoDate(value, true);
}

function salaryFromObject(value: unknown): string | null {
  const row = asRecord(value);
  if (!row) return text(value);
  return (
    text(row.description) ??
    text(row.salaryDescriptionPlain) ??
    salaryRange(
      row.min ?? row.salary_from,
      row.max ?? row.salary_to,
      row.currency ?? row.salary_currency,
    )
  );
}

function requestFor(config: AtsBoardConfig): AtsRequest {
  const token = encodeURIComponent(config.boardToken);
  switch (config.provider) {
    case "greenhouse":
      return {
        url: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
        allowedHosts: ["boards-api.greenhouse.io"],
      };
    case "lever": {
      const host =
        config.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
      return {
        url: `https://${host}/v0/postings/${token}?mode=json`,
        allowedHosts: [host],
      };
    }
    case "ashby":
      return {
        url: `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`,
        allowedHosts: ["api.ashbyhq.com"],
      };
    case "workable":
      return {
        url: `https://www.workable.com/api/accounts/${token}?details=true`,
        allowedHosts: ["www.workable.com"],
      };
  }
}

function greenhouseJobs(
  payload: unknown,
  config: AtsBoardConfig,
): RawSourceJob[] {
  const rows = asRecord(payload)?.jobs;
  if (!Array.isArray(rows)) {
    throw new Error(`${config.id}: expected a jobs array`);
  }
  let recognizable = 0;
  const jobs = rows.flatMap((entry): RawSourceJob[] => {
    const row = asRecord(entry);
    if (!row) return [];
    const title = text(row.title);
    const jobUrl = httpsUrl(row.absolute_url);
    if (!title || !jobUrl) return [];
    recognizable += 1;
    return [
      {
        jobUrl,
        title,
        company: config.company,
        location: nestedText(row.location, "name"),
        jobType: null,
        jobLevel: null,
        description: stripHtml(row.content),
        salary: null,
        workArrangement: null,
        listingDate: isoDate(row.updated_at),
        source: config.id,
      },
    ];
  });
  if (rows.length > 0 && recognizable === 0) {
    throw new Error(`${config.id}: invalid payload; no recognizable job rows`);
  }
  return jobs;
}

function leverJobs(
  payload: unknown,
  config: AtsBoardConfig,
): RawSourceJob[] {
  if (!Array.isArray(payload)) {
    throw new Error(`${config.id}: expected a postings array`);
  }
  let recognizable = 0;
  const jobs = payload.flatMap((entry): RawSourceJob[] => {
    const row = asRecord(entry);
    if (!row) return [];
    const title = text(row.text);
    const jobUrl = httpsUrl(row.hostedUrl);
    if (!title || !jobUrl) return [];
    recognizable += 1;
    return [
      {
        jobUrl,
        title,
        company: config.company,
        location: nestedText(row.categories, "location"),
        jobType: nestedText(row.categories, "commitment"),
        jobLevel: nestedText(row.categories, "level"),
        description:
          text(row.descriptionPlain) ?? stripHtml(row.description),
        salary:
          text(row.salaryDescriptionPlain) ??
          salaryFromObject(row.salaryRange),
        workArrangement: text(row.workplaceType),
        listingDate: timestamp(row.createdAt),
        source: config.id,
      },
    ];
  });
  if (payload.length > 0 && recognizable === 0) {
    throw new Error(`${config.id}: invalid payload; no recognizable job rows`);
  }
  return jobs;
}

function ashbyJobs(
  payload: unknown,
  config: AtsBoardConfig,
): RawSourceJob[] {
  const rows = asRecord(payload)?.jobs;
  if (!Array.isArray(rows)) {
    throw new Error(`${config.id}: expected a jobs array`);
  }
  let recognizable = 0;
  const jobs = rows.flatMap((entry): RawSourceJob[] => {
    const row = asRecord(entry);
    if (!row) return [];
    const title = text(row.title);
    const jobUrl = httpsUrl(row.jobUrl);
    if (!title || !jobUrl) return [];
    recognizable += 1;
    if (row.isListed === false) return [];
    return [
      {
        jobUrl,
        title,
        company: config.company,
        location: text(row.location),
        jobType: text(row.employmentType),
        jobLevel: null,
        description:
          text(row.descriptionPlain) ?? stripHtml(row.descriptionHtml),
        salary:
          text(asRecord(row.compensation)?.compensationTierSummary) ??
          text(asRecord(row.compensation)?.scrapeableCompensationSalarySummary),
        workArrangement:
          text(row.workplaceType) ??
          (row.isRemote === true ? "Remote" : null),
        listingDate: isoDate(row.publishedAt),
        source: config.id,
      },
    ];
  });
  if (rows.length > 0 && recognizable === 0) {
    throw new Error(`${config.id}: invalid payload; no recognizable job rows`);
  }
  return jobs;
}

function workableJobs(
  payload: unknown,
  config: AtsBoardConfig,
): RawSourceJob[] {
  const rows = Array.isArray(payload) ? payload : asRecord(payload)?.jobs;
  if (!Array.isArray(rows)) {
    throw new Error(`${config.id}: expected a jobs array`);
  }
  let recognizable = 0;
  const jobs = rows.flatMap((entry): RawSourceJob[] => {
    const row = asRecord(entry);
    if (!row) return [];
    const state = text(row.state)?.toLowerCase();
    const title = text(row.title) ?? text(row.full_title);
    const jobUrl =
      httpsUrl(row.url) ??
      httpsUrl(row.shortlink) ??
      httpsUrl(row.application_url);
    if (!title || !jobUrl) return [];
    recognizable += 1;
    if (state && state !== "published") return [];
    const location = asRecord(row.location);
    return [
      {
        jobUrl,
        title,
        company: config.company,
        location:
          text(location?.location_str) ??
          ([text(location?.city), text(location?.country)]
            .filter(Boolean)
            .join(", ") ||
            null),
        jobType: text(row.employment_type),
        jobLevel: null,
        description:
          stripHtml(row.description) ??
          stripHtml(row.description_html) ??
          text(row.full_description),
        salary: salaryFromObject(row.salary),
        workArrangement:
          text(location?.workplace_type) ??
          (location?.telecommuting === true ? "Remote" : null),
        listingDate: isoDate(row.created_at),
        source: config.id,
      },
    ];
  });
  if (rows.length > 0 && recognizable === 0) {
    throw new Error(`${config.id}: invalid payload; no recognizable job rows`);
  }
  return jobs;
}

export function createAtsAdapter(config: AtsBoardConfig): SourceAdapter {
  const request = requestFor(config);
  return {
    id: config.id,
    allowedHosts: request.allowedHosts,
    async fetch(ctx: SourceContext): Promise<RawSourceJob[]> {
      const payload = await ctx.fetchJson(request.url, request.allowedHosts);
      switch (config.provider) {
        case "greenhouse":
          return greenhouseJobs(payload, config);
        case "lever":
          return leverJobs(payload, config);
        case "ashby":
          return ashbyJobs(payload, config);
        case "workable":
          return workableJobs(payload, config);
      }
    },
  };
}

export function createAtsAdapters(
  boards: readonly AtsBoardConfig[],
): SourceAdapter[] {
  return boards.map(createAtsAdapter);
}

export function getAtsBoardRequest(config: AtsBoardConfig): AtsRequest {
  return requestFor(config);
}
