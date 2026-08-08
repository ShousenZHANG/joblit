"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { GhostAddRow } from "./GhostAddRow";
import { suggestLinkLabel } from "./linkBrand";
import type { ResumeLink } from "./types";

interface EntryLinkRowsProps {
  links: ResumeLink[];
  label: string;
  /** Hint for the link-label field — sections word this differently. */
  labelPlaceholder: string;
  idPrefix: string;
  maxLinks: number;
  onUpdate: (index: number, field: keyof ResumeLink, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/**
 * The optional links attached to one experience or project (a repo, a live
 * demo). Same recognition behaviour as the profile links: a known host fills
 * an empty label for you.
 */
export function EntryLinkRows({
  links,
  label,
  labelPlaceholder,
  idPrefix,
  maxLinks,
  onUpdate,
  onAdd,
  onRemove,
}: EntryLinkRowsProps) {
  const t = useTranslations("resumeForm");

  return (
    <div className="space-y-2">
      <Label className="text-[13px]">{label}</Label>
      <div className="space-y-1.5">
        {links.map((link, index) => (
          <div key={`${idPrefix}-link-${index}`} className="flex items-center gap-2">
            <Input
              aria-label={`${label} ${t("label")} ${index + 1}`}
              value={link.label}
              onChange={(e) => onUpdate(index, "label", e.target.value)}
              placeholder={labelPlaceholder}
              className="w-[8.5rem] shrink-0"
            />
            <Input
              aria-label={`${label} ${t("url")} ${index + 1}`}
              value={link.url}
              inputMode="url"
              onChange={(e) => {
                const nextUrl = e.target.value;
                onUpdate(index, "url", nextUrl);
                if (!link.label.trim()) {
                  const suggested = suggestLinkLabel(nextUrl);
                  if (suggested) onUpdate(index, "label", suggested);
                }
              }}
              placeholder={t("linkUrlPlaceholder")}
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              aria-label={`${t("remove")} ${link.label || index + 1}`}
              title={t("remove")}
              onClick={() => onRemove(index)}
              className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 motion-reduce:transition-none"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
      {links.length < maxLinks ? (
        <GhostAddRow label={t("addLink")} onClick={onAdd} className="py-2 text-xs" />
      ) : null}
    </div>
  );
}
