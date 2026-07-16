let readiness: Promise<void> | null = null;

export function ensureTrustedLocalStorage(): Promise<void> {
  if (!readiness) {
    readiness = chrome.storage.local
      .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
      .catch(() => {
        readiness = null;
        throw new Error("Secure extension storage is unavailable");
      });
  }
  return readiness;
}
