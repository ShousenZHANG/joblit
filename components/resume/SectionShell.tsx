"use client";

import { useCallback, type ElementType, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useResumeContext } from "./ResumeContext";
import type { SectionId } from "./constants";
import { cn } from "@/lib/utils";

interface SectionShellProps {
  id: SectionId;
  icon: ElementType;
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * One section inside the single-scroll editor.
 *
 * The editor used to show one section at a time, swapped by an icon rail —
 * which meant the user could never see their resume's shape, only a slice of
 * it. Every section now lives in one scroll, headed by a sticky, collapsible
 * bar; the rail became a jump-and-highlight scrollspy. This is the pattern the
 * whole category converged on, and the step-number badge went with it: a
 * numbered step implies a wizard, and this was never a wizard.
 *
 * Completeness is signalled by exception: a filled section is the calm,
 * full-contrast default, and only an EMPTY one dims. The first cut put a
 * green tick beside every filled heading and an emerald tint under every
 * filled icon — six ticks and six green squares once the resume was done,
 * decoration exactly when there was nothing left to say. No percentage, no
 * score, and never a warning colour for an empty optional section.
 */
export function SectionShell({
  id,
  icon: Icon,
  title,
  description,
  children,
}: SectionShellProps) {
  const {
    registerSectionNode,
    collapsedSections,
    toggleSectionCollapsed,
    sectionCompletion,
    t,
  } = useResumeContext();

  const collapsed = collapsedSections.has(id);
  const complete = sectionCompletion[id];
  const reduceMotion = useReducedMotion();

  const setNode = useCallback(
    (node: HTMLElement | null) => registerSectionNode(id, node),
    [registerSectionNode, id],
  );

  return (
    <section
      ref={setNode}
      id={`resume-section-${id}`}
      data-testid={`resume-section-${id}`}
      // Offset the scroll target so the sticky header never lands under the
      // section title when the rail jumps here.
      className="scroll-mt-4"
      aria-labelledby={`resume-section-${id}-heading`}
    >
      <div className="sticky top-0 z-10 -mx-1 bg-background/92 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <button
          type="button"
          onClick={() => toggleSectionCollapsed(id)}
          aria-expanded={!collapsed}
          aria-controls={`resume-section-${id}-body`}
          className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
        >
          <span
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted",
              complete ? "text-muted-foreground" : "text-muted-foreground/45",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <h2
            id={`resume-section-${id}-heading`}
            className={cn(
              "min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.012em]",
              complete ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {title}
          </h2>
          {complete ? null : (
            <span className="sr-only">{t("sectionEmpty")}</span>
          )}
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              collapsed && "-rotate-90",
            )}
          />
        </button>
      </div>

      {/* Collapse animates height + opacity instead of blinking in and out.
          overflow-hidden only DURING the transition — a permanently clipped
          body would cut off focus rings and the entry cards' hover shadows. */}
      <div
        id={`resume-section-${id}-body`}
        aria-hidden={collapsed || undefined}
        inert={collapsed || undefined}
      >
        <AnimatePresence initial={false}>
          {collapsed ? null : (
            <motion.div
              key="body"
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{
                height: "auto",
                opacity: 1,
                transitionEnd: { overflow: "visible" },
              }}
              exit={
                reduceMotion
                  ? { opacity: 0, transition: { duration: 0 } }
                  : { height: 0, opacity: 0 }
              }
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: "hidden" }}
            >
              <div className="space-y-4 px-1 pb-2 pt-1">
                {description ? (
                  <p className="max-w-[62ch] text-[13px] leading-[1.55] text-muted-foreground">
                    {description}
                  </p>
                ) : null}
                {children}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
