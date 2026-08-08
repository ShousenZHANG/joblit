"use client";

import { useId, useRef } from "react";
import { Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { COARSE_POINTER_MIN_HEIGHT } from "@/components/ui/touchTarget";

interface JobSearchBarProps {
  q: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  isDebouncing?: boolean;
}

export function JobSearchBar({
  q,
  onQueryChange,
  onSubmit,
  placeholder,
  isDebouncing,
}: JobSearchBarProps) {
  const t = useTranslations("jobs");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      {/* Screen-reader label only. The visible "Search saved jobs" heading
          made the search column taller than the location select beside it,
          so the two controls could never share a baseline — and a magnifier
          icon plus placeholder already say what the field is. */}
      <label htmlFor={inputId} className="sr-only">
        {t("searchLabel")}
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={inputId}
        ref={inputRef}
        className={`h-11 rounded-xl border-border/80 pl-9 pr-9 shadow-xs ${COARSE_POINTER_MIN_HEIGHT}`}
        placeholder={placeholder}
        value={q}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {isDebouncing && (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
