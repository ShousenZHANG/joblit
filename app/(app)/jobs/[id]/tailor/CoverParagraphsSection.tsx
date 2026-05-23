"use client";

import { Sparkles, RotateCcw } from "lucide-react";
import type { AiContent, AiCoverParagraph } from "@/lib/shared/schemas/aiContent";

const PARAGRAPH_LABELS: Record<keyof AiContent["cover"], string> = {
  paragraphOne: "Hook - Paragraph 1",
  paragraphTwo: "Match - Paragraph 2",
  paragraphThree: "Close - Paragraph 3",
};

interface CoverParagraphsSectionProps {
  cover: AiContent["cover"];
  onChange: (next: AiContent["cover"]) => void;
}

export function CoverParagraphsSection({ cover, onChange }: CoverParagraphsSectionProps) {
  function patch(key: keyof AiContent["cover"], next: AiCoverParagraph) {
    onChange({ ...cover, [key]: next });
  }

  return (
    <section className="space-y-3 rounded-[1.35rem] border border-border/70 bg-card p-4 shadow-[0_18px_46px_-36px_rgba(15,23,42,0.45),0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-border/40">
      <header className="flex items-center gap-2">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-brand-emerald-50 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-brand-emerald-700 ring-1 ring-brand-emerald-100">
          <Sparkles className="h-3 w-3" aria-hidden />
          AI drafted
        </span>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Cover letter
        </h2>
      </header>

      {(Object.keys(PARAGRAPH_LABELS) as Array<keyof AiContent["cover"]>).map(
        (key) => (
          <ParagraphEditor
            key={key}
            label={PARAGRAPH_LABELS[key]}
            paragraph={cover[key]}
            onChange={(next) => patch(key, next)}
          />
        ),
      )}
    </section>
  );
}

interface ParagraphEditorProps {
  label: string;
  paragraph: AiCoverParagraph;
  onChange: (next: AiCoverParagraph) => void;
}

function ParagraphEditor({ label, paragraph, onChange }: ParagraphEditorProps) {
  const value = paragraph.userEdit ?? paragraph.aiText;
  const charCount = value.length;
  const isUserEdited =
    paragraph.userEdit !== undefined && paragraph.userEdit !== paragraph.aiText;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
          <span>{charCount} chars</span>
          {isUserEdited ? (
            <button
              type="button"
              onClick={() =>
                onChange({ ...paragraph, userEdit: undefined, accepted: true })
              }
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              Reset to AI
            </button>
          ) : null}
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) =>
          onChange({
            ...paragraph,
            userEdit:
              e.target.value === paragraph.aiText ? undefined : e.target.value,
            accepted: true,
          })
        }
        rows={4}
        className="w-full resize-y rounded-2xl border border-border/70 bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-inner shadow-black/5 placeholder:text-muted-foreground/60 focus-visible:border-brand-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-400/40"
        aria-label={label}
      />
    </div>
  );
}
