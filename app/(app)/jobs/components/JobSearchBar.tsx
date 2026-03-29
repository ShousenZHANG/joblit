"use client";

import { useRef } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

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
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        className="pl-9 pr-9"
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
  );
}
