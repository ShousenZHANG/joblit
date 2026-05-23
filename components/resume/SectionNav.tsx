"use client";

import { useEffect, useRef, type ElementType } from "react";
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

type SectionTranslationKey =
  | "personalInfo"
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "skills";

const SECTION_CONFIG: Array<{ id: SectionId; tKey: SectionTranslationKey; icon: ElementType }> = [
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
 * Primary resume navigation.
 *
 * Desktop: a compact 64px icon rail. Each section button shows only an
 * icon with a localized hover tooltip, removing the long-text labels
 * that previously truncated to "Professional expe…" on languages
 * with longer translations. The bottom dock owns the persistent
 * Saved/Saving indicator and the primary Save action — both pure-icon
 * with descriptive tooltips so the user always knows the button's
 * purpose without consuming horizontal space.
 *
 * Mobile: the existing horizontal section tab row with the trailing
 * Eye preview + Save action cluster — unchanged.
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

  const saveStatusLabel = saving
    ? t("saving")
    : hasAnyContent
      ? t("toastSaved")
      : t("toastAddDetailsFirst");
  const saveButtonLabel = saving ? t("saving") : t("saveSelectedResume");

  return (
    <nav className={cn("flex [contain:layout_style]", className)} aria-label="Resume sections">
      {/* Desktop: 64px icon rail */}
      <div className="hidden lg:flex lg:h-full lg:w-full lg:flex-col lg:items-center lg:bg-card/35 lg:px-2 lg:py-3">
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
                  "group relative grid h-10 w-10 place-items-center rounded-xl",
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

        {/* Bottom dock — Save action with built-in status indicator. */}
        <div className="mt-3 flex w-full flex-col items-center gap-2 border-t border-border/70 pt-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasAnyContent}
            aria-label={saveButtonLabel}
            aria-describedby="resume-save-status"
            title={saveButtonLabel}
            data-guide-anchor="resume_setup"
            data-guide-highlight={guideHighlight ? "true" : "false"}
            className={cn(
              "relative grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-white",
              "shadow-[0_10px_24px_-14px_rgba(5,150,105,0.7)] transition-[transform,box-shadow,filter] duration-150 ease-out motion-reduce:transition-none",
              "hover:brightness-105 hover:shadow-[0_14px_28px_-14px_rgba(5,150,105,0.8)]",
              "active:scale-[0.97] motion-reduce:active:scale-100",
              "disabled:cursor-not-allowed disabled:opacity-60",
              guideHighlight &&
                "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background",
            )}
          >
            {saving ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Save className="h-[18px] w-[18px]" aria-hidden />
            )}
            {/* Status badge — sits at the corner of the Save button so its
                meaning is always tied to the action itself. Saved state
                shows a check, saving shows a pulsing amber dot, empty
                state hides it entirely so we never display a mystery
                indicator floating in the sidebar. */}
            {hasAnyContent ? (
              <span
                aria-hidden
                className={cn(
                  "absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full ring-2 ring-card",
                  saving
                    ? "bg-amber-500 motion-safe:animate-pulse"
                    : "bg-emerald-500",
                )}
              >
                {!saving ? (
                  <Check className="h-2.5 w-2.5 text-white" aria-hidden />
                ) : null}
              </span>
            ) : null}
          </button>
          {/* Visually-hidden live region — keeps screen-reader users in
              the loop without crowding the rail. */}
          <span
            id="resume-save-status"
            role="status"
            aria-live="polite"
            className="sr-only"
          >
            {saveStatusLabel}
          </span>
        </div>
      </div>

      {/* Mobile: horizontal scroll tabs + trailing icon cluster */}
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

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={!hasAnyContent}
            onClick={() => {
              setPreviewOpen(true);
              schedulePreview(0);
            }}
            aria-label={t("preview")}
            title={t("preview")}
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-emerald-300 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Eye className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasAnyContent}
            aria-label={saveButtonLabel}
            title={saveButtonLabel}
            data-guide-anchor="resume_setup"
            data-guide-highlight={guideHighlight ? "true" : "false"}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-white shadow-sm",
              "transition-[transform,filter] duration-150 ease-out motion-reduce:transition-none",
              "hover:brightness-105 active:scale-[0.97] motion-reduce:active:scale-100",
              "disabled:cursor-not-allowed disabled:opacity-60",
              guideHighlight &&
                "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background",
            )}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
