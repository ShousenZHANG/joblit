import { describe, it, expect, beforeEach } from "vitest";
import { setToken, clearToken, getAuthStatus } from "./auth";
import { STORAGE_KEYS } from "@ext/shared/constants";

describe("auth", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  describe("setToken", () => {
    it("stores token and expiration in chrome.storage.local", async () => {
      await setToken("jfext_test123");
      const result = await chrome.storage.local.get([STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.TOKEN_EXPIRES_AT]);
      expect(result[STORAGE_KEYS.AUTH_TOKEN]).toBe("jfext_test123");
      expect(result[STORAGE_KEYS.TOKEN_EXPIRES_AT]).toBeGreaterThan(Date.now());
    });

    it("sets expiration to ~90 days from now", async () => {
      const before = Date.now();
      await setToken("jfext_test");
      const result = await chrome.storage.local.get(STORAGE_KEYS.TOKEN_EXPIRES_AT);
      const expiresAt = result[STORAGE_KEYS.TOKEN_EXPIRES_AT];
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      expect(expiresAt - before).toBeGreaterThan(ninetyDaysMs - 10000);
      expect(expiresAt - before).toBeLessThan(ninetyDaysMs + 10000);
    });
  });

  describe("clearToken", () => {
    it("removes auth data from storage", async () => {
      await setToken("jfext_test");
      await clearToken();
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.AUTH_TOKEN,
        STORAGE_KEYS.TOKEN_EXPIRES_AT,
        STORAGE_KEYS.USER_ID,
        STORAGE_KEYS.CACHED_PROFILE,
      ]);
      expect(result[STORAGE_KEYS.AUTH_TOKEN]).toBeUndefined();
      expect(result[STORAGE_KEYS.TOKEN_EXPIRES_AT]).toBeUndefined();
    });
  });

  describe("getAuthStatus", () => {
    it("returns not authenticated when no token stored", async () => {
      const status = await getAuthStatus();
      expect(status.authenticated).toBe(false);
      expect(status.userId).toBeNull();
    });

    it("returns authenticated when valid token stored", async () => {
      await setToken("jfext_valid");
      const status = await getAuthStatus();
      expect(status.authenticated).toBe(true);
    });

    it("returns not authenticated and clears expired token", async () => {
      await chrome.storage.local.set({
        [STORAGE_KEYS.AUTH_TOKEN]: "jfext_expired",
        [STORAGE_KEYS.TOKEN_EXPIRES_AT]: Date.now() - 1000, // expired
      });
      const status = await getAuthStatus();
      expect(status.authenticated).toBe(false);

      // Verify token was cleared
      const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN);
      expect(result[STORAGE_KEYS.AUTH_TOKEN]).toBeUndefined();
    });
  });
});
