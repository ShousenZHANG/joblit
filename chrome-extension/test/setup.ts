/**
 * Vitest setup — provide a minimal chrome.* API mock for tests
 * that interact with chrome.storage and chrome.runtime.
 */

const storageData: Record<string, unknown> = {};

const storageMock = {
  local: {
    get: async (keys: string | string[] | Record<string, unknown>) => {
      if (typeof keys === "string") {
        return { [keys]: storageData[keys] };
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          result[key] = storageData[key];
        }
        return result;
      }
      // Object form — return stored values or defaults
      const result: Record<string, unknown> = {};
      for (const [key, defaultVal] of Object.entries(keys as Record<string, unknown>)) {
        result[key] = storageData[key] ?? defaultVal;
      }
      return result;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(storageData, items);
    },
    remove: async (keys: string | string[]) => {
      const toRemove = Array.isArray(keys) ? keys : [keys];
      for (const key of toRemove) {
        delete storageData[key];
      }
    },
    clear: async () => {
      for (const key of Object.keys(storageData)) {
        delete storageData[key];
      }
    },
  },
};

const runtimeMock = {
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
  },
  writable: true,
  configurable: true,
});
