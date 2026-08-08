"use client";

import { Bold, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GhostAddRow } from "./GhostAddRow";

interface BulletListProps {
  bullets: string[];
  label: string;
  placeholder: string;
  idPrefix: string;
  markdownKeyPrefix: string;
  onUpdate: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  applyBoldMarkdown: (
    key: string,
    currentValue: string,
    onChange: (nextValue: string) => void,
  ) => void;
  registerMarkdownRef: (
    key: string,
  ) => (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

/**
 * The achievement bullets under an experience or project.
 *
 * Previously every bullet carried its own visible "Bullet" label plus a "Bold
 * selected" button and a text "Remove" button — three pieces of chrome per
 * line, on a list where the lines are the point. Now the list gets one label,
 * each row gets a bullet glyph, and the two actions are icon buttons that
 * surface on hover or focus.
 */
export function BulletList({
  bullets,
  label,
  placeholder,
  idPrefix,
  markdownKeyPrefix,
  onUpdate,
  onAdd,
  onRemove,
  applyBoldMarkdown,
  registerMarkdownRef,
}: BulletListProps) {
  const t = useTranslations("resumeForm");

  return (
    <div className="space-y-2">
      <Label className="text-[13px]">{label}</Label>
      <div className="space-y-1.5">
        {bullets.map((bullet, index) => (
          <div key={`${idPrefix}-${index}`} className="group/bullet flex items-start gap-1.5">
            <span
              aria-hidden
              className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40"
            />
            <Textarea
              id={`${idPrefix}-${index}`}
              aria-label={`${label} ${index + 1}`}
              ref={registerMarkdownRef(`${markdownKeyPrefix}-${index}`)}
              value={bullet}
              rows={1}
              onChange={(e) => onUpdate(index, e.target.value)}
              placeholder={placeholder}
              className="min-h-9 flex-1 resize-none py-1.5 leading-relaxed"
            />
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                aria-label={t("boldSelected")}
                title={t("boldSelected")}
                onClick={() =>
                  applyBoldMarkdown(`${markdownKeyPrefix}-${index}`, bullet, (next) =>
                    onUpdate(index, next),
                  )
                }
                className="grid h-9 w-8 place-items-center rounded-md text-muted-foreground/0 transition-colors duration-150 group-hover/bullet:text-muted-foreground hover:!text-foreground focus-visible:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 motion-reduce:transition-none"
              >
                <Bold className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`${t("remove")} ${index + 1}`}
                title={t("remove")}
                onClick={() => onRemove(index)}
                className="grid h-9 w-8 place-items-center rounded-md text-muted-foreground/0 transition-colors duration-150 group-hover/bullet:text-muted-foreground hover:!text-destructive focus-visible:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 motion-reduce:transition-none"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
      <GhostAddRow label={t("addBullet")} onClick={onAdd} className="py-2 text-xs" />
    </div>
  );
}
