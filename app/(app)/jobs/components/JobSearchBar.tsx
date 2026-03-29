"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { Clock, Search, X } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSearchHistory } from "../hooks/useSearchHistory";

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

interface JobSearchBarProps {
  q: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
}

export function JobSearchBar({ q, onQueryChange, onSubmit, placeholder }: JobSearchBarProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { history, addToHistory, clearHistory } = useSearchHistory();

  const debouncedQ = useDebouncedValue(q, 200);

  const { data } = useQuery({
    queryKey: ["job-suggestions", debouncedQ],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/suggestions?q=${encodeURIComponent(debouncedQ)}`);
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json() as Promise<{ suggestions: string[] }>;
    },
    enabled: debouncedQ.length >= 2,
    staleTime: 120_000,
    placeholderData: keepPreviousData,
  });

  const suggestions = data?.suggestions ?? [];
  const showHistory = open && q.length === 0 && history.length > 0;
  const showSuggestions = open && q.length >= 2 && suggestions.length > 0;
  const showDropdown = showHistory || showSuggestions;

  const selectItem = useCallback(
    (value: string) => {
      onQueryChange(value);
      addToHistory(value);
      setOpen(false);
      queueMicrotask(onSubmit);
    },
    [onQueryChange, addToHistory, onSubmit],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const related = e.relatedTarget as Node | null;
      if (listRef.current?.contains(related)) return;
      setOpen(false);
    },
    [],
  );

  return (
    <CommandPrimitive
      shouldFilter={false}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          inputRef.current?.blur();
        }
      }}
      className="relative"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <CommandPrimitive.Input
          ref={inputRef}
          className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] pl-9"
          placeholder={placeholder}
          value={q}
          onValueChange={onQueryChange}
          onFocus={() => setOpen(true)}
          onBlur={handleBlur}
        />
      </div>

      {showDropdown && (
        <CommandPrimitive.List
          ref={listRef}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[260px] overflow-y-auto rounded-lg border bg-popover shadow-lg"
        >
          {showHistory && (
            <CommandPrimitive.Group heading="Recent searches">
              {history.map((item) => (
                <CommandPrimitive.Item
                  key={item}
                  value={item}
                  onSelect={selectItem}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{item}</span>
                </CommandPrimitive.Item>
              ))}
              <div className="border-t px-3 py-1.5">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    clearHistory();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  Clear history
                </button>
              </div>
            </CommandPrimitive.Group>
          )}

          {showSuggestions && (
            <CommandPrimitive.Group>
              {suggestions.map((item) => (
                <CommandPrimitive.Item
                  key={item}
                  value={item}
                  onSelect={selectItem}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    <HighlightMatch text={item} query={q} />
                  </span>
                </CommandPrimitive.Item>
              ))}
            </CommandPrimitive.Group>
          )}
        </CommandPrimitive.List>
      )}
    </CommandPrimitive>
  );
}
