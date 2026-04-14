"use client";

import { useCallback, useEffect, useState } from "react";

const WATCHED_KEY = "joblit_discover_video_watched";
const FAVORITED_KEY = "joblit_discover_video_favorited";

type SetApi = {
  ids: Set<string>;
  has: (id: string) => boolean;
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
};

function readSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, value: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(value)));
  } catch {
    /* quota exceeded, ignore */
  }
}

/**
 * localStorage-backed Set with cross-tab sync via the `storage` event.
 * Returns a stable API — callers don't need to manage React state.
 */
function useLocalSet(key: string): SetApi {
  const [ids, setIds] = useState<Set<string>>(() => readSet(key));

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      setIds(readSet(key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const has = useCallback((id: string) => ids.has(id), [ids]);

  const add = useCallback(
    (id: string) => {
      setIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        writeSet(key, next);
        return next;
      });
    },
    [key],
  );

  const remove = useCallback(
    (id: string) => {
      setIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        writeSet(key, next);
        return next;
      });
    },
    [key],
  );

  const toggle = useCallback(
    (id: string) => {
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        writeSet(key, next);
        return next;
      });
    },
    [key],
  );

  const clear = useCallback(() => {
    setIds(new Set());
    writeSet(key, new Set());
  }, [key]);

  return { ids, has, add, remove, toggle, clear };
}

export function useWatchedVideos(): SetApi {
  return useLocalSet(WATCHED_KEY);
}

export function useFavoritedVideos(): SetApi {
  return useLocalSet(FAVORITED_KEY);
}
