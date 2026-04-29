"use client";

import { useEffect, useRef } from "react";
import {
  User,
  FileText,
  Briefcase,
  FolderKanban,
  GraduationCap,
  Wrench,
  Save,
  Eye,
  Loader2,
  Check,
} from "lucide-react";
import { useResumeContext } from "./ResumeContext";
import type { SectionId } from "./constants";
import { getSectionIds } from "./constants";
import { cn } from "@/lib/utils";

type SectionTranslationKey = "personalInfo" | "summary" | "experience" | "projects" | "education" | "skills";

const SECTION_CONFIG: Array<{ id: SectionId; tKey: SectionTranslationKey; icon: React.ElementType }> = [
  { id: "personal", tKey: "personalInfo", icon: User },
  { id: "summary", tKey: "summary", icon: FileText },
  { id: "experience", tKey: "experience", icon: Briefcase },
  { id: "projects", tKey: "projects", icon: FolderKanban },
  { id: "education", tKey: "education", icon: GraduationCap },
  { id: "skills", tKey: "skills", icon: Wrench },
];

interface SectionNavProps {
  className?: string;
}

/**
 * SectionNav — primary section rail.
 *
 * Desktop: a fixed 56px-wide icon rail per the Joblit Design System.
 * Each item is a 40×40 button with a hover tooltip; the active item
 * gets an emerald accent bar and tinted background. Below the section
 * list a thin divider separates the "rail foot" with the Save action
 * (and a saved-state pulse dot) — replaces the previous full-width
 * page header so the form canvas reclaims ~56px of vertical space.
 *
 * Mobile: a horizontal scrolling pill row with smooth scroll-into-view
 * of the active tab. Save and Preview move to a compact action cluster
 * at the trailing edge of the same row so the header bar can be
 * deleted on mobile too.
 */
export function SectionNav({ className }: SectionNavProps) {
  const {
    activeSection,
    setActiveSection,
    locale,
    t,
    saving,
    handleSave,
    hasAnyContent,
    setPreviewOpen,
    schedulePreview,
    isTaskHighlighted,
  } = useResumeContext();

  const visibleSectionIds = getSectionIds(locale);
  const visibleSections = SECTION_CONFIG.filter((s) => visibleSectionIds.includes(s.id));
  const guideHighlight = isTaskHighlighted("resume_setup");

  // Keep the active mobile pill centred.
  const mobileTabRefs = useRef<Map<SectionId, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    const node = mobileTabRefs.current.get(activeSection);
    if (!node) return;
    node.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeSection]);

  return (
    <nav
      className={cn("flex [contain:layout_style]", className)}
      aria-label="Resume sections"
    >
      {/* Desktop: 56px icon-only rail with rail foot */}
      <div className="hidden lg:flex lg:h-full lg:w-full lg:flex-col lg:items-center lg:py-2.5">
        {/* Section list */}
        <div className="flex flex-1 flex-col items-center gap-1">
          {visibleSections.map(({ id, tKey, icon: Icon }) => {
            const isActive = activeSection === id;
            const label = t(tKey);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={label}
                title={label}
                className={cn(
                  "group relative grid h-10 w-10 place-items-center rounded-[9px]",
                  "transition-colors duration-150 ease-out motion-reduce:transition-none",
                  "active:scale-[0.97] motion-reduce:active:scale-100",
                  isActive
                    ? "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-emerald-600 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Rail foot — small saved-state indicator. Primary Save CTA
            lives in the sticky ResumeSaveBar above the form so it is
            always discoverable. */}
        {hasAnyContent ? (
          <div className="flex w-full flex-col items-center gap-1.5 pb-1">
            <div aria-hidden className="h-px w-8 bg-border" />
            <span
              aria-live="polite"
              aria-label={saving ? t("saving") : t("toastSaved")}
              title={saving ? t("saving") : t("toastSaved")}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full",
                saving
                  ? "bg-amber-500/10 text-amber-600"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              )}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
            </span>
          </div>
        ) : null}
      </div>

      {/* Mobile: horizontal scrollable tabs + trailing action cluster */}
      <div className="flex w-full items-center gap-2 px-3 py-2 lg:hidden">
        <div
          className="scrollbar-hide flex flex-1 gap-2 overflow-x-auto scroll-smooth"
          role="tablist"
        >
          {visibleSections.map(({ id, tKey, icon: Icon }) => {
            const isActive = activeSection === id;
            return (
              <button
                key={id}
                ref={(node) => {
                  mobileTabRefs.current.set(id, node);
                }}
                type="button"
                onClick={() => setActiveSection(id)}
                aria-current={isActive ? "page" : undefined}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
                  "transition-colors duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:transition-none",
                  isActive
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "border-border bg-card text-muted-foreground hover:border-emerald-300",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{t(tKey)}</span>
              </button>
            );
          })}
        </div>

        {/* Mobile action cluster — Eye preview + Save */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={!hasAnyContent}
            onClick={() => {
              setPreviewOpen(true);
              schedulePreview(0);
            }}
            aria-label={t("preview")}
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-emerald-300 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Eye className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            aria-label={saving ? t("saving") : t("saveSelectedResume")}
            data-guide-anchor="resume_setup"
            data-guide-highlight={guideHighlight ? "true" : "false"}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-white shadow-sm",
              "transition-[transform,filter] duration-150 ease-out",
              "hover:brightness-105 active:scale-[0.97] motion-reduce:active:scale-100",
              "disabled:cursor-not-allowed disabled:opacity-60",
              guideHighlight &&
                "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background",
            )}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
