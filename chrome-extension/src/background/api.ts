import { STORAGE_KEYS, DEFAULT_API_BASE, PROFILE_CACHE_TTL } from "@ext/shared/constants";
import { resolveStoredApiBase } from "@ext/shared/apiBase";
import { ApiRequestError } from "./apiErrors";
import type { LocalAiTarget } from "@ext/shared/hermesTypes";

/** Get the stored API base URL. */
async function getApiBase(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.API_BASE);
  return resolveStoredApiBase(
    result[STORAGE_KEYS.API_BASE] ?? DEFAULT_API_BASE,
  );
}

/** Get the stored auth token. */
async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.TOKEN_EXPIRES_AT,
  ]);
  const token = result[STORAGE_KEYS.AUTH_TOKEN];
  const expiresAt = result[STORAGE_KEYS.TOKEN_EXPIRES_AT];

  if (!token) return null;
  if (expiresAt && Date.now() > expiresAt) {
    await chrome.storage.local.remove([
      STORAGE_KEYS.AUTH_TOKEN,
      STORAGE_KEYS.TOKEN_EXPIRES_AT,
      STORAGE_KEYS.USER_ID,
    ]);
    return null;
  }
  return token;
}

const API_TIMEOUT_MS = 15_000;

/** Make an authenticated request to the Joblit API with a 15s timeout. */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const [base, token] = await Promise.all([getApiBase(), getToken()]);

  if (!token) {
    throw new Error("Not authenticated. Please connect your Joblit account.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const timeoutError = new Error(
        `Request timed out after ${API_TIMEOUT_MS / 1000}s`,
      );
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the user's active resume profile. */
export async function fetchProfile(locale = "en-AU") {
  const res = await apiFetch(`/api/ext/profile?locale=${encodeURIComponent(locale)}`);
  if (!res.ok) {
    throw new ApiRequestError(res.status, `Profile fetch failed: ${res.status}`);
  }
  return (await res.json()).data;
}

/** Fetch the flattened profile for form filling. Uses cache if fresh unless force=true. */
export async function fetchFlatProfile(locale = "en-AU", force = false) {
  if (!force) {
    const cached = await chrome.storage.local.get(STORAGE_KEYS.CACHED_PROFILE);
    const cachedProfile = cached[STORAGE_KEYS.CACHED_PROFILE];

    if (
      cachedProfile &&
      cachedProfile.locale === locale &&
      Date.now() - cachedProfile.fetchedAt < PROFILE_CACHE_TTL
    ) {
      return cachedProfile.data;
    }
  }

  const res = await apiFetch(`/api/ext/profile/flat?locale=${encodeURIComponent(locale)}`);
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      `Flat profile fetch failed: ${res.status}`,
    );
  }
  const json = await res.json();

  if (json.data) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.CACHED_PROFILE]: {
        data: json.data,
        locale,
        fetchedAt: Date.now(),
      },
    });
  }

  return json.data;
}

/** Post a form submission record. */
export async function postSubmission(data: Record<string, unknown>) {
  const res = await apiFetch("/api/ext/submissions", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      `Submission recording failed: ${res.status}`,
    );
  }
  return (await res.json()).data;
}

/** Fetch submission history. */
export async function fetchSubmissions(params: {
  pageDomain?: string;
  atsProvider?: string;
  formSignature?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params.pageDomain) qs.set("pageDomain", params.pageDomain);
  if (params.atsProvider) qs.set("atsProvider", params.atsProvider);
  if (params.formSignature) qs.set("formSignature", params.formSignature);
  if (params.limit) qs.set("limit", String(params.limit));

  const res = await apiFetch(`/api/ext/submissions?${qs.toString()}`);
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      `Submissions fetch failed: ${res.status}`,
    );
  }
  return (await res.json()).data;
}

/** Fetch field mapping rules. */
export async function fetchFieldMappings(params: {
  atsProvider?: string;
  pageDomain?: string;
}) {
  const qs = new URLSearchParams();
  if (params.atsProvider) qs.set("atsProvider", params.atsProvider);
  if (params.pageDomain) qs.set("pageDomain", params.pageDomain);

  const res = await apiFetch(`/api/ext/field-mappings?${qs.toString()}`);
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      `Mappings fetch failed: ${res.status}`,
    );
  }
  return (await res.json()).data;
}

/** Match a job URL to an existing Job in Joblit. */
export async function matchJob(url: string) {
  const res = await apiFetch(`/api/ext/jobs/match?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    throw new ApiRequestError(res.status, `Job match failed: ${res.status}`);
  }
  return (await res.json()).data;
}

/** Mark a job as APPLIED. */
export async function markJobApplied(jobId: string) {
  const res = await apiFetch("/api/ext/jobs/applied", {
    method: "POST",
    body: JSON.stringify({ jobId }),
  });
  if (!res.ok) {
    throw new ApiRequestError(res.status, `Mark applied failed: ${res.status}`);
  }
  return (await res.json()).data;
}

/** Import Seek jobs scraped from the user's own logged-in browser session
 *  (see ADR-0003). The endpoint applies tombstone + dedupe server-side. */
export async function importSeekJobs(items: unknown[]) {
  const res = await apiFetch("/api/ext/jobs/import", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    throw new ApiRequestError(res.status, `Seek import failed: ${res.status}`);
  }
  return (await res.json()).data as { imported: number; invalid: number };
}

/** Create or update a field mapping rule. */
export async function putFieldMapping(data: Record<string, unknown>) {
  const res = await apiFetch("/api/ext/field-mappings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      `Mapping update failed: ${res.status}`,
    );
  }
  return (await res.json()).data;
}

/** Fetch the server-owned, self-contained prompt. Page code never sees it. */
export async function fetchAiPromptEnvelope(input: {
  jobId: string;
  target: LocalAiTarget;
}): Promise<unknown> {
  const res = await apiFetch("/api/ext/applications/prompt", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new ApiRequestError(res.status, `AI prompt fetch failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchAiTriagePromptEnvelope(input: {
  jobIds: string[];
}): Promise<unknown> {
  const res = await apiFetch("/api/ext/jobs/triage-prompt", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new ApiRequestError(res.status, `AI triage prompt fetch failed: ${res.status}`);
  }
  return res.json();
}

/** Non-secret local AI defaults synced with Joblit (endpoint + profile only). */
export async function fetchLocalAiDefaults(): Promise<unknown> {
  const res = await apiFetch("/api/ext/local-ai/settings");
  if (!res.ok) {
    throw new ApiRequestError(res.status, `Local AI defaults fetch failed: ${res.status}`);
  }
  return res.json();
}

export async function pushLocalAiDefaults(input: {
  hermesEndpoint: string;
  hermesProfile: string;
}): Promise<void> {
  const res = await apiFetch("/api/ext/local-ai/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new ApiRequestError(res.status, `Local AI defaults push failed: ${res.status}`);
  }
}
