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
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-semibold text-foreground/75"
      >
        {t("searchLabel")}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id={inputId}
          ref={inputRef}
          className={`pl-9 pr-9 ${COARSE_POINTER_MIN_HEIGHT}`}
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
          <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
