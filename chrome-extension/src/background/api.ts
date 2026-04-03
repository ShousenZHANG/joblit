import { STORAGE_KEYS, DEFAULT_API_BASE, PROFILE_CACHE_TTL } from "@ext/shared/constants";

/** Get the stored API base URL. */
async function getApiBase(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.API_BASE);
  return result[STORAGE_KEYS.API_BASE] ?? DEFAULT_API_BASE;
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
    // Token expired, clean up
    await chrome.storage.local.remove([
      STORAGE_KEYS.AUTH_TOKEN,
      STORAGE_KEYS.TOKEN_EXPIRES_AT,
      STORAGE_KEYS.USER_ID,
    ]);
    return null;
  }
  return token;
}

/** Make an authenticated request to the Jobflow API. */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const [base, token] = await Promise.all([getApiBase(), getToken()]);

  if (!token) {
    throw new Error("Not authenticated. Please connect your Jobflow account.");
  }

  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

/** Fetch the user's active resume profile. */
export async function fetchProfile(locale = "en-AU") {
  const res = await apiFetch(`/api/ext/profile?locale=${encodeURIComponent(locale)}`);
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  const json = await res.json();
  return json.data;
}

/** Fetch the flattened profile for form filling. Uses cache if fresh. */
export async function fetchFlatProfile(locale = "en-AU") {
  // Check cache first
  const cached = await chrome.storage.local.get(STORAGE_KEYS.CACHED_PROFILE);
  const cachedProfile = cached[STORAGE_KEYS.CACHED_PROFILE];

  if (
    cachedProfile &&
    cachedProfile.locale === locale &&
    Date.now() - cachedProfile.fetchedAt < PROFILE_CACHE_TTL
  ) {
    return cachedProfile.data;
  }

  // Fetch fresh
  const res = await apiFetch(`/api/ext/profile/flat?locale=${encodeURIComponent(locale)}`);
  if (!res.ok) throw new Error(`Flat profile fetch failed: ${res.status}`);
  const json = await res.json();

  // Cache it
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
