/**
 * Vitest setup — provide a minimal chrome.* API mock for tests
 * that interact with chrome.storage and chrome.runtime.
 */

const localStorageData: Record<string, unknown> = {};
const sessionStorageData: Record<string, unknown> = {};
const storageListeners = new Set<(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void>();

function createStorageArea(
  storageData: Record<string, unknown>,
  areaName: "local" | "session",
) {
  return {
    get: async (
      keys: string | string[] | Record<string, unknown>,
      callback?: (result: Record<string, unknown>) => void,
    ) => {
      let result: Record<string, unknown>;
      if (typeof keys === "string") {
        result = { [keys]: storageData[keys] };
      } else if (Array.isArray(keys)) {
        result = {};
        for (const key of keys) {
          result[key] = storageData[key];
        }
      } else {
        // Object form — return stored values or defaults
        result = {};
        for (const [key, defaultVal] of Object.entries(keys)) {
          result[key] = storageData[key] ?? defaultVal;
        }
      }
      callback?.(result);
      return result;
    },
    set: async (items: Record<string, unknown>, callback?: () => void) => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: storageData[key], newValue: value };
      }
      Object.assign(storageData, items);
      for (const listener of storageListeners) listener(changes, areaName);
      callback?.();
    },
    remove: async (keys: string | string[], callback?: () => void) => {
      const toRemove = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of toRemove) {
        changes[key] = { oldValue: storageData[key], newValue: undefined };
        delete storageData[key];
      }
      for (const listener of storageListeners) listener(changes, areaName);
      callback?.();
    },
    clear: async (callback?: () => void) => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of Object.keys(storageData)) {
        changes[key] = { oldValue: storageData[key], newValue: undefined };
        delete storageData[key];
      }
      if (Object.keys(changes).length > 0) {
        for (const listener of storageListeners) listener(changes, areaName);
      }
      callback?.();
    },
    setAccessLevel: async () => {},
  };
}

const storageMock = {
  local: createStorageArea(localStorageData, "local"),
  session: createStorageArea(sessionStorageData, "session"),
  onChanged: {
    addListener: (listener: (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => void) => storageListeners.add(listener),
    removeListener: (listener: (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => void) => storageListeners.delete(listener),
    hasListener: (listener: (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => void) => storageListeners.has(listener),
  },
};

const runtimeMock = {
  id: "joblit-test-extension",
  getURL: (path: string) => `chrome-extension://joblit-test-extension/${path}`,
  getManifest: () => ({ content_scripts: [] }),
  sendMessage: (_message: unknown, callback?: (response: unknown) => void) => {
    callback?.({ success: true });
  },
  onMessage: {
    addListener: () => {},
    removeListener: () => {},
  },
  lastError: null as chrome.runtime.LastError | null,
};

// Assign to global
Object.defineProperty(globalThis, "chrome", {
  value: {
    storage: storageMock,
    runtime: runtimeMock,
    tabs: {
      query: async () => [],
      sendMessage: () => {},
    },
    commands: {
      onCommand: {
        addListener: () => {},
      },
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
      remove: async () => true,
    },
    scripting: {
      executeScript: async () => [],
    },
  },
  writable: true,
  configurable: true,
});
