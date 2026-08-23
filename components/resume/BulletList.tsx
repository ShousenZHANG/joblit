"use client";

import { useCallback, useEffect, useRef } from "react";
import { Bold, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
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
 *
 * The keyboard behaviour is the one every list editor has trained people to
 * expect, because reaching for the mouse to add the next bullet is the single
 * most repeated interaction in this form:
 *
 *   Enter          new bullet below, focused
 *   Shift+Enter    a line break inside this bullet
 *   Backspace      on an empty bullet, delete it and land in the one above
 *
 * Enter appends rather than splitting at the caret. Splitting is what a
 * document editor does; these are discrete claims, and a caret left mid-word
 * almost always means the user simply finished typing there.
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

  const nodesRef = useRef(new Map<number, HTMLTextAreaElement>());
  /** Which row to focus once the list re-renders at its new length. */
  const pendingFocusRef = useRef<number | null>(null);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    const node = nodesRef.current.get(Math.min(target, bullets.length - 1));
    if (!node) return;
    node.focus();
    // Land at the end, not at the start: the user is continuing to write.
    const end = node.value.length;
    node.setSelectionRange(end, end);
  }, [bullets.length]);

  const addAndFocus = useCallback(() => {
    pendingFocusRef.current = bullets.length;
    onAdd();
  }, [bullets.length, onAdd]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        pendingFocusRef.current = bullets.length;
        onAdd();
        return;
      }
      if (
        event.key === "Backspace" &&
        bullets[index] === "" &&
        bullets.length > 1
      ) {
        event.preventDefault();
        pendingFocusRef.current = Math.max(0, index - 1);
        onRemove(index);
      }
    },
    [bullets, onAdd, onRemove],
  );

  return (
    <div className="space-y-2">
      <Label className="text-[13px]">{label}</Label>
      <div className="space-y-1.5">
        {bullets.map((bullet, index) => {
          const markdownKey = `${markdownKeyPrefix}-${index}`;
          const registerMarkdown = registerMarkdownRef(markdownKey);
          return (
            <div key={`${idPrefix}-${index}`} className="group/bullet flex items-start gap-1.5">
              <span
                aria-hidden
                className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40"
              />
              <AutoGrowTextarea
                id={`${idPrefix}-${index}`}
                aria-label={`${label} ${index + 1}`}
                ref={(element) => {
                  registerMarkdown(element);
                  if (element) nodesRef.current.set(index, element);
                  else nodesRef.current.delete(index);
                }}
                value={bullet}
                onChange={(e) => onUpdate(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                placeholder={placeholder}
                className="min-h-9 flex-1 resize-none py-1.5 leading-relaxed"
              />
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={t("boldSelected")}
                  title={t("boldSelected")}
                  onClick={() =>
                    applyBoldMarkdown(markdownKey, bullet, (next) => onUpdate(index, next))
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
          );
        })}
      </div>
      <GhostAddRow label={t("addBullet")} onClick={addAndFocus} className="py-2 text-xs" />
    </div>
  );
}
