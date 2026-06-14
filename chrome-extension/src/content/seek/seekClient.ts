// Pure Seek graphql helpers — no DOM, no network — so they unit-test cleanly.
// Mirrors the server worker's JobSearchV6 query + mapping (ADR-0003); the
// difference is WHERE it runs: in the user's logged-in browser (residential
// IP + real session), which is what clears Cloudflare.

import type { SeekImportItem } from "@ext/shared/types";

export const SEEK_GRAPHQL_URL = "https://au.seek.com/graphql";

// The OFFICIAL JobSearchV6 query, verbatim from a live Seek capture. Seek's
// graphql gateway is a trusted-document setup — it rejects ad-hoc query
// variants ("UNSTABLE_QUERY_ERROR"), so this must match byte-for-byte what the
// site sends. We only READ a subset in mapSeekJob; the rest is returned and
// ignored. Do not trim — trimming changes the document and trips the gateway.
export const JOB_SEARCH_V6_QUERY =
  "query JobSearchV6($params: JobSearchV6QueryInput!, $locale: Locale!, $timezone: Timezone!) {\n  jobSearchV6(params: $params) {\n    canonicalCompany {\n      description\n      __typename\n    }\n    data {\n      advertiser {\n        id\n        description\n        __typename\n      }\n      branding {\n        serpLogoUrl\n        __typename\n      }\n      bulletPoints\n      classifications {\n        classification {\n          id\n          description\n          __typename\n        }\n        subclassification {\n          id\n          description\n          __typename\n        }\n        __typename\n      }\n      companyName\n      companyProfileStructuredDataId\n      currencyLabel\n      displayType\n      employer {\n        companyUrl\n        __typename\n      }\n      externalReferences {\n        id\n        sourceSystem\n        type\n        metadata {\n          name\n          assets {\n            profilePhotoUrl\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      id\n      isFeatured\n      listingDate {\n        dateTimeUtc\n        label(context: JOB_POSTED, length: SHORT, timezone: $timezone, locale: $locale)\n        __typename\n      }\n      locations {\n        countryCode\n        label\n        seoHierarchy {\n          contextualName\n          __typename\n        }\n        __typename\n      }\n      roleId\n      salaryLabel\n      solMetadata\n      tags {\n        label\n        type\n        __typename\n      }\n      teaser\n      title\n      tracking\n      workArrangements {\n        displayText\n        __typename\n      }\n      workTypes\n      __typename\n    }\n    facets {\n      distinctTitle {\n        count\n        id\n        label\n        __typename\n      }\n      location {\n        count\n        id\n        label {\n          lang\n          text\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    queryParamLabels {\n      keywords\n      locations {\n        contextualName {\n          text\n          __typename\n        }\n        kind\n        __typename\n      }\n      locationsHierarchy {\n        kind\n        label {\n          text\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    info {\n      experiment\n      newSince\n      source\n      timeTaken\n      __typename\n    }\n    intentSuggestions {\n      count\n      id\n      label {\n        defaultText\n        lang\n        __typename\n      }\n      params {\n        classification\n        companyName\n        dateRange\n        distance\n        keywords\n        maxSalary\n        minSalary\n        salaryType\n        siteKey\n        sortMode\n        subclassification\n        tags\n        where\n        workArrangement\n        workTypes\n        __typename\n      }\n      type\n      __typename\n    }\n    isQueryModified\n    location {\n      defaultDistanceKms\n      description\n      isGranular\n      localisedDescriptions {\n        contextualName\n        lang\n        __typename\n      }\n      locationDescription\n      type\n      whereId\n      __typename\n    }\n    searchExecuted {\n      classification\n      companyName\n      dateRange\n      distance\n      keywords\n      maxSalary\n      minSalary\n      salaryType\n      siteKey\n      sortMode\n      subclassification\n      tags\n      where\n      workArrangement\n      workTypes\n      __typename\n    }\n    searchParams {\n      advertisergroup\n      advertiserid\n      basekeywords\n      classification\n      companyid\n      companyname\n      companyprofilestructureddataid\n      companysearch\n      daterange\n      distance\n      duplicates\n      encodedurl\n      engineconfig\n      eventcapturesessionid\n      eventcaptureuserid\n      facets\n      include\n      jobid\n      keywords\n      locale\n      maxlistingdate\n      minlistingdate\n      newsince\n      page\n      pagesize\n      queryhints\n      relatedsearchescount\n      salaryrange\n      salarytype\n      savedsearchid\n      sitekey\n      solid\n      sortmode\n      source\n      statetoken\n      subclassification\n      tags\n      userid\n      userqueryid\n      usersessionid\n      where\n      whereid\n      whereids\n      workarrangement\n      worktype\n      __typename\n    }\n    solMetadata\n    sortModes {\n      isActive\n      name\n      value\n      __typename\n    }\n    suggestions {\n      asyncPillsToken\n      company {\n        count\n        search {\n          companyName\n          keywords\n          __typename\n        }\n        __typename\n      }\n      location {\n        description\n        whereId\n        __typename\n      }\n      pills {\n        isActive\n        keywords\n        label\n        __typename\n      }\n      relatedSearches {\n        keywords\n        totalJobs\n        __typename\n      }\n      showSABFilter\n      __typename\n    }\n    totalCount\n    userQueryId\n    __typename\n  }\n}";

const SEEK_ID_RE = /^\d+$/;

export interface JobSearchV6Variables {
  params: {
    channel: string;
    eventCaptureSessionId: string;
    eventCaptureUserId: string;
    userSessionId: string;
    solId: string;
    include: string[];
    locale: string;
    page: number;
    pageSize: number;
    queryHints: string[];
    relatedSearchesCount: number;
    siteKey: string;
    source: string;
    keywords?: string;
    where?: string;
  };
  locale: string;
  timezone: string;
}

/** A client-side UUID for the analytics/session tracking fields (not auth). */
function genId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : "00000000-0000-4000-8000-000000000000";
}

/** Build JobSearchV6 variables matching the site's own request shape. Seek's
 *  gateway validates the document, so the variables must carry the tracking +
 *  hint fields the real client sends (their values are client-generated, not
 *  secret). where is optional — omitted means All Australia. */
export function buildSeekVariables(
  keywords: string,
  page = 1,
  pageSize = 100,
  where = "",
): JobSearchV6Variables {
  const sid = genId();
  const params: JobSearchV6Variables["params"] = {
    channel: "web",
    eventCaptureSessionId: sid,
    eventCaptureUserId: sid,
    userSessionId: sid,
    solId: genId(),
    include: ["seoData", "gptTargeting", "relatedSearches"],
    locale: "en-AU",
    page,
    pageSize,
    queryHints: ["spellingCorrection"],
    relatedSearchesCount: 12,
    siteKey: "AU",
    source: "FE_SERP",
  };
  const kw = keywords.trim();
  if (kw) params.keywords = kw;
  const w = where.trim();
  if (w) params.where = w;
  return { params, locale: "en-AU", timezone: "Australia/Sydney" };
}

interface JobSearchV6Parsed {
  jobs: unknown[];
  totalCount: number;
}

/** Pull the listings array + totalCount out of a JobSearchV6 response. */
export function parseJobSearchV6(payload: unknown): JobSearchV6Parsed {
  const root =
    payload && typeof payload === "object"
      ? (payload as { data?: { jobSearchV6?: { data?: unknown; totalCount?: unknown } } }).data
          ?.jobSearchV6
      : undefined;
  const jobs = Array.isArray(root?.data) ? (root!.data as unknown[]) : [];
  return { jobs, totalCount: Number(root?.totalCount ?? 0) };
}

/** Map one JobSearchV6 row to the import-item shape. Returns null for rows
 *  without a numeric id / title (the numeric id also closes the URL-injection
 *  vector, matching the server `map_job`). */
export function mapSeekJob(raw: unknown): SeekImportItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "");
  const title = String(r.title ?? "").trim();
  if (!SEEK_ID_RE.test(id) || !title) return null;

  const advertiser = r.advertiser as { description?: unknown } | undefined;
  const company =
    String(advertiser?.description ?? r.companyName ?? "").trim() || null;

  const locations = r.locations as Array<{ label?: unknown }> | undefined;
  const location =
    Array.isArray(locations) && locations[0]?.label
      ? String(locations[0].label).trim() || null
      : null;

  const workTypes = r.workTypes as unknown[] | undefined;
  const jobType = Array.isArray(workTypes)
    ? workTypes.map((w) => String(w).trim()).filter(Boolean).join(", ") || null
    : null;

  const teaser = String(r.teaser ?? "").trim();
  const bullets = Array.isArray(r.bulletPoints)
    ? (r.bulletPoints as unknown[])
        .map((b) => String(b).trim())
        .filter(Boolean)
        .map((b) => `- ${b}`)
        .join("\n")
    : "";
  const description = [teaser, bullets].filter(Boolean).join("\n") || null;

  const wa = r.workArrangements as { displayText?: unknown } | undefined;
  const workArrangement = wa?.displayText
    ? String(wa.displayText).trim() || null
    : null;

  const ld = r.listingDate as { dateTimeUtc?: unknown } | undefined;
  const listingDate = ld?.dateTimeUtc ? String(ld.dateTimeUtc) : null;

  return {
    jobUrl: `https://au.seek.com/job/${id}`,
    title,
    company,
    location,
    jobType,
    description,
    salary: String(r.salaryLabel ?? "").trim() || null,
    workArrangement,
    listingDate,
    site: "seek",
  };
}

/** Derive the search keywords from a Seek SERP URL (query param or SEO path). */
export function extractSeekKeywords(href: string): string {
  try {
    const u = new URL(href);
    const kw = u.searchParams.get("keywords");
    if (kw && kw.trim()) return kw.trim();
    // SEO path form: /software-engineer-jobs, /data-analyst-jobs/in-Sydney
    const m = u.pathname.match(/^\/([a-z0-9-]+)-jobs/i);
    if (m) return m[1].replace(/-/g, " ").trim();
    return "";
  } catch {
    return "";
  }
}

/** True for a Seek search-results URL (where importing makes sense). */
export function isSeekSearchUrl(href: string): boolean {
  try {
    const u = new URL(href);
    if (u.hostname.toLowerCase() !== "au.seek.com") return false;
    return u.pathname === "/jobs" || /-jobs(\/|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}
