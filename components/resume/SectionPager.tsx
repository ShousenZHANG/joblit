"use client";

import { ArrowLeft, ArrowRight, FileDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { getSectionIds } from "./constants";
import { SECTION_CONFIG_BY_ID } from "./sectionConfig";
import { useResumeContext } from "./ResumeContext";
import { cn } from "@/lib/utils";

/**
 * Focus-mode pager: previous / position / next, under the single visible
 * section.
 *
 * Desktop only, and deliberately so. Below `lg` the editor stays a single
 * scroll, because that layout has no preview pane beside it — showing one
 * section at a time with no view of the whole is the exact complaint that
 * retired the original one-section-at-a-time editor. On `lg` and up the live
 * PDF supplies the overview, which is what makes focusing the form safe.
 *
 * The last step is not "Next". A pager that dead-ends leaves the user asking
 * what now; the final section points at the thing they came to do.
 */
export function SectionPager({ className }: { className?: string }) {
  const t = useTranslations("resumeForm");
  const {
    locale,
    activeSection,
    activeSectionIndex,
    sectionCount,
    setActiveSection,
    setPreviewOpen,
  } = useResumeContext();

  const sections = getSectionIds(locale);
  const previous = activeSectionIndex > 0 ? sections[activeSectionIndex - 1] : null;
  const next =
    activeSectionIndex < sectionCount - 1 ? sections[activeSectionIndex + 1] : null;
  const label = (id: (typeof sections)[number]) => {
    const config = SECTION_CONFIG_BY_ID.get(id);
    return config ? t(config.tKey) : "";
  };

  const buttonBase = cn(
    "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium",
    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600",
    "disabled:pointer-events-none disabled:opacity-40",
  );

  return (
    <nav
      aria-label={t("sectionPagerAria")}
      data-testid="resume-section-pager"
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:px-6",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => previous && setActiveSection(previous)}
        disabled={!previous}
        data-testid="resume-pager-prev"
        className={cn(buttonBase, "text-muted-foreground hover:bg-muted hover:text-foreground")}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        <span className="max-w-[12ch] truncate">
          {previous ? label(previous) : t("sectionPagerStart")}
        </span>
      </button>

      <span
        className="shrink-0 text-xs tabular-nums text-muted-foreground"
        aria-live="polite"
        data-testid="resume-pager-position"
      >
        {t("sectionPagerPosition", {
          current: activeSectionIndex + 1,
          total: sectionCount,
        })}
      </span>

      {next ? (
        <button
          type="button"
          onClick={() => setActiveSection(next)}
          data-testid="resume-pager-next"
          className={cn(buttonBase, "text-foreground hover:bg-muted")}
        >
          <span className="max-w-[12ch] truncate">{label(next)}</span>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          data-testid="resume-pager-finish"
          className={cn(
            buttonBase,
            "bg-brand-emerald-600 text-white hover:bg-brand-emerald-700",
          )}
        >
          <FileDown className="h-4 w-4" aria-hidden />
          {t("sectionPagerFinish")}
        </button>
      )}
      <span className="sr-only">{label(activeSection)}</span>
    </nav>
  );
}
