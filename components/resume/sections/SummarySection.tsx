"use client";

import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SectionShell } from "../SectionShell";

interface SummarySectionProps {
  summary: string;
  setSummary: (value: string) => void;
  locale: string;
  applyBoldMarkdown: (
    key: string,
    currentValue: string,
    onChange: (nextValue: string) => void,
  ) => void;
  registerMarkdownRef: (
    key: string,
  ) => (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

export function SummarySection({
  summary,
  setSummary,
  applyBoldMarkdown,
  registerMarkdownRef,
}: SummarySectionProps) {
  const t = useTranslations("resumeForm");

  return (
    <SectionShell
      id="summary"
      icon={FileText}
      title={t("summary")}
      description={t("summaryDesc")}
    >
      <div className="space-y-2">
        <div className="relative">
          <Textarea
            id="resume-summary"
            aria-label={t("summary")}
            ref={registerMarkdownRef("summary")}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t("summaryPlaceholder")}
            rows={7}
            className="pb-8"
          />
          {/* Formatting and length sit inside the field's own footer rather
              than above it — the label row no longer competes with the
              section heading for attention. */}
          <div className="absolute inset-x-2 bottom-1.5 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => applyBoldMarkdown("summary", summary, setSummary)}
            >
              {t("boldSelected")}
            </Button>
            <span className="pr-1 text-xs tabular-nums text-muted-foreground">
              {summary.length}
            </span>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
