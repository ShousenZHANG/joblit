"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Eye } from "lucide-react";
import { useResumeContext } from "./ResumeContext";
import type { SectionId } from "./constants";
import { getSectionIds } from "./constants";
import { SECTION_CONFIG_BY_ID } from "./sectionConfig";
import { cn } from "@/lib/utils";
import {
  COARSE_POINTER_MIN_HEIGHT,
  COARSE_POINTER_TARGET,
} from "@/components/ui/touchTarget";

interface SectionNavProps {
  className?: string;
  /** The scrolling form column the spy observes. */
  scrollRootRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Section rail — a jump list and a position indicator, not a router.
 *
 * Since the editor became one continuous scroll, this no longer swaps what is
 * rendered: clicking scrolls to a section, and scrolling highlights the one
 * you are in. The save button that used to be docked at the bottom is gone
 * with the manual save it triggered (autosave now; see useResumeAutosave) —
 * mixing an explicit save control with silent autosave is the one thing every
 * design system tells you not to do.
 *
 * The quiet tick on an icon means the section has content. It is the only
 * progress signal here: no percentage, no score.
 */
export function SectionNav({ className, scrollRootRef }: SectionNavProps) {
  const {
    activeSection,
    setActiveSection,
    sectionCompletion,
    locale,
    t,
    hasAnyContent,
    setPreviewOpen,
    schedulePreview,
  } = useResumeContext();
  const reduceMotion = useReducedMotion();

  // Drive both nav order AND visibility from getSectionIds(locale) so the rail
  // matches the resume's per-locale module order (CN: Education before
  // Experience).
  const visibleSections = getSectionIds(locale)
    .map((id) => SECTION_CONFIG_BY_ID.get(id))
    .filter((section): section is NonNullable<typeof section> => section !== undefined);

  const mobileTabRefs = useRef<Map<SectionId, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    const node = mobileTabRefs.current.get(activeSection);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeSection]);

  return (
    <nav
      className={cn("flex [contain:layout_style]", className)}
      aria-label={t("sectionsAria")}
    >
      {/* Desktop: 64px icon rail.

          Completion is signalled by exception, not by trophy: a section with
          content renders at normal contrast (the calm default) and only an
          EMPTY one dims to 40%. The previous version pinned a green tick
          badge on every filled icon — six sections filled meant six badges,
          which read as unread-notification clutter exactly when the resume
          was in its best state. */}
      <div className="hidden lg:flex lg:h-full lg:w-full lg:flex-col lg:items-center lg:bg-card/35 lg:px-2 lg:py-3">
        <div className="flex flex-1 flex-col items-center gap-1">
          {visibleSections.map(({ id, tKey, icon: Icon }) => {
            const isActive = activeSection === id;
            const label = t(tKey);
            const complete = sectionCompletion[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                aria-current={isActive ? "true" : undefined}
                aria-label={complete ? label : `${label} — ${t("sectionEmpty")}`}
                data-testid={`resume-rail-${id}`}
                data-complete={complete ? "true" : "false"}
                className={cn(
                  "group relative grid h-10 w-10 place-items-center rounded-xl",
                  COARSE_POINTER_TARGET,
                  "transition-colors duration-150 ease-out motion-reduce:transition-none",
                  "active:scale-[0.97] motion-reduce:active:scale-100",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600",
                  isActive
                    ? "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : complete
                      ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                      : "text-muted-foreground/40 hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {/* No visual label. A per-icon hover chip popped on every
                    pass-through of the rail — flicker, not help. The icons
                    are legible, the section headings sit in the scroll column
                    beside them, and aria-label carries the name for AT. */}
                {isActive ? (
                  <motion.span
                    aria-hidden
                    // One shared element sliding between icons reads as "the
                    // indicator followed me"; per-icon fade-ins read as six
                    // separate lights. Reduced motion snaps instead of slides.
                    layoutId="resume-rail-indicator"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 500, damping: 40 }
                    }
                    className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-emerald-600"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile: horizontal jump chips + preview */}
      <div className="flex w-full items-center gap-2 px-3 py-2 lg:hidden">
        <div
          className="scrollbar-hide flex flex-1 gap-2 overflow-x-auto scroll-smooth"
          role="list"
          aria-label={t("sectionsAria")}
        >
          {visibleSections.map(({ id, tKey, icon: Icon }) => {
            const isActive = activeSection === id;
            const complete = sectionCompletion[id];
            return (
              <button
                key={id}
                ref={(node) => {
                  mobileTabRefs.current.set(id, node);
                }}
                type="button"
                onClick={() => setActiveSection(id)}
                aria-current={isActive ? "true" : undefined}
                aria-label={complete ? t(tKey) : `${t(tKey)} — ${t("sectionEmpty")}`}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
                  COARSE_POINTER_MIN_HEIGHT,
                  "transition-colors duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:transition-none",
                  isActive
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : complete
                      ? "border-border bg-card text-muted-foreground hover:border-emerald-300"
                      : "border-border bg-card text-muted-foreground/50 hover:border-emerald-300",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{t(tKey)}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={!hasAnyContent}
          onClick={() => {
            setPreviewOpen(true);
            schedulePreview(0);
          }}
          aria-label={t("preview")}
          title={t("preview")}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-emerald-300 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            COARSE_POINTER_TARGET,
          )}
        >
          <Eye className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {/* The scroll spy lives with the scrolling column, not the rail. */}
      <SectionSpy scrollRootRef={scrollRootRef} />
    </nav>
  );
}

/**
 * Highlights the section occupying the top of the reading area. Uses a
 * rootMargin that collapses the viewport to a band just under the sticky
 * header, so "active" means "the one you are reading", not "the one that
 * happens to be tallest".
 */
function SectionSpy({
  scrollRootRef,
}: {
  scrollRootRef?: React.RefObject<HTMLElement | null>;
}) {
  const { locale, setActiveSectionQuietly, sectionNodesRef } = useResumeContext();

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = scrollRootRef?.current ?? null;
    const ids = getSectionIds(locale);
    // Effects run after every ref has attached, so the anchor map is populated
    // by the time we read it — no render-triggering registration needed.
    const nodes = ids
      .map((id) => ({ id, node: sectionNodesRef.current.get(id) }))
      .filter((entry): entry is { id: SectionId; node: HTMLElement } => Boolean(entry.node));
    if (nodes.length === 0) return;

    const visible = new Set<SectionId>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.sectionId as SectionId | undefined;
          if (!id) continue;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // First in document order wins, so scrolling up highlights the section
        // being scrolled into rather than the one being left.
        const next = ids.find((id) => visible.has(id));
        if (next) setActiveSectionQuietly(next);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );

    for (const { id, node } of nodes) {
      node.dataset.sectionId = id;
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, [locale, sectionNodesRef, setActiveSectionQuietly, scrollRootRef]);

  return null;
}
