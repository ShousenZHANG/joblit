"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "jobflow:search-history";
const MAX_ITEMS = 10;

function readStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function writeStorage(items: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(readStorage);

  const addToHistory = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const deduped = prev.filter((item) => item !== trimmed);
      const next = [trimmed, ...deduped].slice(0, MAX_ITEMS);
      writeStorage(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    writeStorage([]);
    setHistory([]);
  }, []);

  return { history, addToHistory, clearHistory } as const;
}
