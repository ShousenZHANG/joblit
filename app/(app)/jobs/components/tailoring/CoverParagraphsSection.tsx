"use client";

import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import type { AiContent, AiCoverParagraph } from "@/lib/shared/schemas/aiContent";

const PARAGRAPH_LABEL_KEYS: Record<keyof AiContent["cover"], string> = {
  paragraphOne: "cover.paragraphOne",
  paragraphTwo: "cover.paragraphTwo",
  paragraphThree: "cover.paragraphThree",
};

interface CoverParagraphsSectionProps {
  cover: AiContent["cover"];
  onChange: (next: AiContent["cover"]) => void;
}

export function CoverParagraphsSection({ cover, onChange }: CoverParagraphsSectionProps) {
  const t = useTranslations("tailor");

  function patch(key: keyof AiContent["cover"], next: AiCoverParagraph) {
    onChange({ ...cover, [key]: next });
  }

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
        {t("cover.title")}
      </h4>

      {(Object.keys(PARAGRAPH_LABEL_KEYS) as Array<keyof AiContent["cover"]>).map(
        (key) => (
          <ParagraphEditor
            key={key}
            label={t(PARAGRAPH_LABEL_KEYS[key])}
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
  const t = useTranslations("tailor");
  const value = paragraph.userEdit ?? paragraph.aiText;
  const charCount = value.length;
  const isUserEdited =
    paragraph.userEdit !== undefined && paragraph.userEdit !== paragraph.aiText;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
          <span>{t("charCount", { count: charCount })}</span>
          {isUserEdited ? (
            <button
              type="button"
              onClick={() =>
                onChange({ ...paragraph, userEdit: undefined, accepted: true })
              }
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              {t("resetToAi")}
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
        className="w-full resize-y rounded-xl border border-border/70 bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:border-brand-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-400/40"
        aria-label={label}
      />
    </div>
  );
}
