export type JobLivenessStatus = "active" | "expired" | "uncertain";

export type JobLivenessReason =
  | "reachable"
  | "http_not_found"
  | "http_gone"
  | "expired_content"
  | "access_denied"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "challenge_page"
  | "login_wall"
  | "job_identity_lost"
  | "missing_from_source_feed"
  | "unexpected_status"
  | "missing_response";

export interface JobLivenessInput {
  requestedUrl: string;
  finalUrl?: string | null;
  httpStatus?: number | null;
  bodyText?: string | null;
  networkError?: boolean;
  seenInSourceFeed?: boolean;
  checkedAt?: string;
}

export interface JobLivenessResult {
  status: JobLivenessStatus;
  reason: JobLivenessReason;
  checkedAt: string;
  httpStatus: number | null;
}

export type PersistedJobLivenessStatus =
  | "ACTIVE"
  | "EXPIRED"
  | "UNCERTAIN";

const CHALLENGE_RE =
  /(?:cf-chl-|cloudflare ray id|checking your browser|verify you are human|captcha|人机验证|安全验证|访问过于频繁)/i;
const LOGIN_WALL_RE =
  /(?:sign in to (?:continue|view)|log in to (?:continue|view)|登录后(?:查看|继续)|请先登录)/i;
const EXPIRED_RE =
  /(?:job|position|role|vacancy).{0,32}(?:no longer available|has been removed|has been filled|is closed|has expired)|applications?\s+(?:are\s+)?(?:closed|no longer accepted)|(?:岗位|职位).{0,24}(?:已下线|已关闭|已过期|不存在|停止招聘|招聘结束)/i;

function response(
  input: JobLivenessInput,
  status: JobLivenessStatus,
  reason: JobLivenessReason,
): JobLivenessResult {
  return {
    status,
    reason,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    httpStatus: input.httpStatus ?? null,
  };
}

function knownJobIdentity(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const queryKeys = new Set([
    "gh_jid",
    "jobid",
    "job_id",
    "jid",
    "postingid",
    "currentjobid",
    "requisitionid",
    "jk",
  ]);
  for (const [key, id] of url.searchParams) {
    if (queryKeys.has(key.toLowerCase()) && id) {
      return id.toLowerCase();
    }
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const viewIndex = segments.findIndex(
    (segment, index) =>
      segment.toLowerCase() === "view" &&
      segments[index - 1]?.toLowerCase() === "jobs",
  );
  if (viewIndex >= 0) {
    return segments[viewIndex + 1]?.toLowerCase() ?? null;
  }
  if (host.endsWith("greenhouse.io")) {
    const jobsIndex = segments.indexOf("jobs");
    return (jobsIndex >= 0 ? segments[jobsIndex + 1] : null)?.toLowerCase() ?? null;
  }
  if (host.endsWith("lever.co") || host.endsWith("ashbyhq.com")) {
    return segments[1]?.toLowerCase() ?? null;
  }
  if (host.endsWith("workable.com")) {
    const jobIndex = segments.findIndex((segment) =>
      ["j", "jobs", "view"].includes(segment.toLowerCase()),
    );
    return (jobIndex >= 0 ? segments[jobIndex + 1] : null)?.toLowerCase() ?? null;
  }
  return null;
}

function redirectedWithoutJobIdentity(
  requestedUrl: string,
  finalUrl: string | null | undefined,
): boolean {
  if (!finalUrl || finalUrl === requestedUrl) return false;
  const identity = knownJobIdentity(requestedUrl);
  if (!identity) return false;
  try {
    return !decodeURIComponent(finalUrl).toLowerCase().includes(identity);
  } catch {
    return !finalUrl.toLowerCase().includes(identity);
  }
}

/**
 * Conservative tri-state liveness. Access failures never become "expired":
 * only explicit 404/410 or unmistakable closed-posting content can do that.
 */
export function classifyJobLiveness(
  input: JobLivenessInput,
): JobLivenessResult {
  if (input.seenInSourceFeed === false) {
    return response(input, "uncertain", "missing_from_source_feed");
  }
  if (input.networkError) {
    return response(input, "uncertain", "network_error");
  }

  const status = input.httpStatus;
  if (status === null || status === undefined || status === 0) {
    return response(input, "uncertain", "missing_response");
  }
  if (status === 404) return response(input, "expired", "http_not_found");
  if (status === 410) return response(input, "expired", "http_gone");
  if (status === 401 || status === 403) {
    return response(input, "uncertain", "access_denied");
  }
  if (status === 429) return response(input, "uncertain", "rate_limited");
  if (status >= 500) return response(input, "uncertain", "server_error");
  if (status < 200 || status >= 300) {
    return response(input, "uncertain", "unexpected_status");
  }

  const body = input.bodyText ?? "";
  if (CHALLENGE_RE.test(body)) {
    return response(input, "uncertain", "challenge_page");
  }
  if (LOGIN_WALL_RE.test(body)) {
    return response(input, "uncertain", "login_wall");
  }
  if (
    redirectedWithoutJobIdentity(
      input.requestedUrl,
      input.finalUrl,
    )
  ) {
    return response(input, "uncertain", "job_identity_lost");
  }
  if (EXPIRED_RE.test(body)) {
    return response(input, "expired", "expired_content");
  }
  return response(input, "active", "reachable");
}

export function toPersistedJobLivenessStatus(
  status: JobLivenessStatus,
): PersistedJobLivenessStatus {
  return status.toUpperCase() as PersistedJobLivenessStatus;
}
