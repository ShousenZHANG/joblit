"use client";

import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { GhostAddRow } from "./GhostAddRow";
import { extractUrls, suggestLinkLabel } from "./linkBrand";
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
 *
 * Pasting is handled for the whole region rather than per field. Adding a link
 * used to be four deliberate acts — press Add, click the label, type it, click
 * the URL, paste — and the label was usually just the host anyway. Now a paste
 * anywhere in here takes every URL it can find, drops them into the empty rows
 * (adding rows up to maxLinks), and names each one from its host.
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

  const labelNodesRef = useRef(new Map<number, HTMLInputElement>());
  const pendingFocusRef = useRef<number | null>(null);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    labelNodesRef.current.get(Math.min(target, links.length - 1))?.focus();
  }, [links.length]);

  const addAndFocus = useCallback(() => {
    pendingFocusRef.current = links.length;
    onAdd();
  }, [links.length, onAdd]);

  const applyUrl = useCallback(
    (index: number, url: string) => {
      onUpdate(index, "url", url);
      const suggested = suggestLinkLabel(url);
      if (suggested && !links[index]?.label.trim()) {
        onUpdate(index, "label", suggested);
      }
    },
    [links, onUpdate],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const text = event.clipboardData.getData("text");
      const urls = extractUrls(text);
      // One URL into a URL field is an ordinary paste; the existing change
      // handler already names it. Only take over when there is something the
      // plain paste cannot do.
      const target = event.target as HTMLElement;
      const intoUrlField = target instanceof HTMLInputElement && target.dataset.linkUrl === "true";
      if (urls.length === 0) return;
      if (urls.length === 1 && intoUrlField) return;

      event.preventDefault();
      // Empty rows first, then new ones, never past the cap.
      let cursor = 0;
      for (const url of urls) {
        while (cursor < links.length && links[cursor]?.url.trim()) cursor += 1;
        if (cursor >= maxLinks) break;
        if (cursor >= links.length) onAdd();
        applyUrl(cursor, url);
        cursor += 1;
      }
    },
    [applyUrl, links, maxLinks, onAdd],
  );

  return (
    <div className="space-y-2" onPaste={handlePaste}>
      <Label className="text-[13px]">{label}</Label>
      <div className="space-y-1.5">
        {links.map((link, index) => (
          <div key={`${idPrefix}-link-${index}`} className="flex items-center gap-2">
            <Input
              aria-label={`${label} ${t("label")} ${index + 1}`}
              ref={(element) => {
                if (element) labelNodesRef.current.set(index, element);
                else labelNodesRef.current.delete(index);
              }}
              value={link.label}
              onChange={(e) => onUpdate(index, "label", e.target.value)}
              placeholder={labelPlaceholder}
              className="w-[8.5rem] shrink-0"
            />
            <Input
              aria-label={`${label} ${t("url")} ${index + 1}`}
              data-link-url="true"
              value={link.url}
              inputMode="url"
              onChange={(e) => applyUrl(index, e.target.value)}
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
        <GhostAddRow label={t("addLink")} onClick={addAndFocus} className="py-2 text-xs" />
      ) : null}
    </div>
  );
}
