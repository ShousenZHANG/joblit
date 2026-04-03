import { STORAGE_KEYS } from "@ext/shared/constants";

export interface AuthStatus {
  authenticated: boolean;
  userId: string | null;
  expiresAt: number | null;
}

/** Store an extension token. */
export async function setToken(token: string): Promise<void> {
  // We don't decode the token — just store it. Expiry comes from the server
  // response when the token was created. For simplicity, we set a long expiry
  // and rely on the server to reject expired tokens.
  await chrome.storage.local.set({
    [STORAGE_KEYS.AUTH_TOKEN]: token,
    [STORAGE_KEYS.TOKEN_EXPIRES_AT]: Date.now() + 90 * 24 * 60 * 60 * 1000, // 90 days
  });
}

/** Clear stored auth data. */
export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.TOKEN_EXPIRES_AT,
    STORAGE_KEYS.USER_ID,
    STORAGE_KEYS.CACHED_PROFILE,
  ]);
}

/** Get current auth status. */
export async function getAuthStatus(): Promise<AuthStatus> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.TOKEN_EXPIRES_AT,
    STORAGE_KEYS.USER_ID,
  ]);

  const token = result[STORAGE_KEYS.AUTH_TOKEN];
  const expiresAt = result[STORAGE_KEYS.TOKEN_EXPIRES_AT];

  if (!token) {
    return { authenticated: false, userId: null, expiresAt: null };
  }

  if (expiresAt && Date.now() > expiresAt) {
    await clearToken();
    return { authenticated: false, userId: null, expiresAt: null };
  }

  return {
    authenticated: true,
    userId: result[STORAGE_KEYS.USER_ID] ?? null,
    expiresAt: expiresAt ?? null,
  };
}
