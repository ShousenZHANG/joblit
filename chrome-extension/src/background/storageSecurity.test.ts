import { beforeEach, describe, expect, it, vi } from "vitest";

describe("trusted extension storage", () => {
  beforeEach(() => vi.resetModules());

  it("restricts local storage to trusted extension contexts", async () => {
    const setAccessLevel = vi.fn().mockResolvedValue(undefined);
    Object.assign(chrome.storage.local, { setAccessLevel });
    const { ensureTrustedLocalStorage } = await import("./storageSecurity");

    await expect(ensureTrustedLocalStorage()).resolves.toBeUndefined();
    expect(setAccessLevel).toHaveBeenCalledOnce();
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("fails closed when Chrome cannot restrict local storage", async () => {
    Object.assign(chrome.storage.local, {
      setAccessLevel: vi.fn().mockRejectedValue(new Error("unsupported")),
    });
    const { ensureTrustedLocalStorage } = await import("./storageSecurity");
    await expect(ensureTrustedLocalStorage()).rejects.toThrow("Secure extension storage is unavailable");
  });
});
