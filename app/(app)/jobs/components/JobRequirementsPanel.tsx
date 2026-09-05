"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  CalendarClock,
  CircleHelp,
  ListChecks,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type {
  JobExperienceRequirement,
  VisibleJobExperienceProjection,
} from "@/lib/shared/jobExperienceAnalysis";
import {
  analyzeJobTechnicalRequirements,
  type TechnicalRequirement,
} from "@/lib/shared/jdTechnicalAnalysis";
import { cn } from "@/lib/utils";
import { experienceEvidenceTargetId } from "./jobExperienceEvidenceTarget";

/**
 * The single quiet block under "Job description": what this job asks for,
 * and nothing else.
 *
 * It replaced two stacked cards (an experience card and a five-section
 * requirement cards). The rules that shaped it:
 *
 * - Only source-verifiable REQUIRED experience findings render. Preferred,
 *   stated, alternative and review evidence stays in the domain result but
 *   does not compete with hard requirements in the product UI.
 * - Technology is one flat cluster. The GATE / CORE / PREFERRED tiers still
 *   exist in the data and drive ordering (gates first), but three labelled
 *   sections told the reader to study a taxonomy before reading chips.
 * - Screening gates, nice-to-have, category dots and the legend are gone by
 *   product decision — the JD text below carries them.
 * - A job with no detectable asks renders nothing. Prominence comes from
 *   appearing only when there is something to say.
 * - Experience uses the semantic brand-blue channel. Technology uses the
 *   existing brand-emerald channel. Text labels carry the meaning; colour only
 *   reinforces the two information families.
 */

type TechnicalSignal = TechnicalRequirement;

const TIER_ORDER: Record<string, number> = {
  REQUIRED: 0,
  PREFERRED: 1,
};

/** Gate-tier skills first, then core, then preferred — one flat cluster. */
export function buildTechnicalSignals(description: string): TechnicalSignal[] {
  return analyzeJobTechnicalRequirements(description)
    .filter((requirement) => requirement.priority !== "MENTIONED")
    .sort((a, b) => {
      if (a.isGate !== b.isGate) return a.isGate ? -1 : 1;
      return (TIER_ORDER[a.priority] ?? 2) - (TIER_ORDER[b.priority] ?? 2);
    })
    .slice(0, 12);
}

function signalTone(): string {
  return "border-brand-emerald-200/70 bg-background text-brand-emerald-800 dark:border-brand-emerald-500/30 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300";
}

type RequirementBlock = {
  key: string;
  relation: "ANY_OF" | "ALL_OF" | null;
  requirements: JobExperienceRequirement[];
};

type ExtendedRelation = NonNullable<JobExperienceRequirement["relation"]> & {
  role?: "TOTAL" | "SUBSET";
};

const EVIDENCE_ACTIVE_MS = 1_600;
const EVIDENCE_RETRY_MS = 125;
const MAX_EVIDENCE_ATTEMPTS = 12;
const evidenceTimers = new WeakMap<HTMLElement, number>();

function focusExperienceEvidence(targetId: string): boolean {
  const target = document.getElementById(targetId);
  if (!target) return false;

  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "center",
  });
  target.focus({ preventScroll: true });
  target.dataset.evidenceActive = "true";

  const previousTimer = evidenceTimers.get(target);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  const timer = window.setTimeout(() => {
    delete target.dataset.evidenceActive;
    evidenceTimers.delete(target);
  }, EVIDENCE_ACTIVE_MS);
  evidenceTimers.set(target, timer);
  return true;
}

function buildRequirementBlocks(
  requirements: JobExperienceRequirement[],
): RequirementBlock[] {
  const consumedGroupIds = new Set<string>();
  const blocks: RequirementBlock[] = [];

  for (const requirement of requirements) {
    const relation = requirement.relation ?? null;
    if (!relation) {
      blocks.push({
        key: requirement.id,
        relation: null,
        requirements: [requirement],
      });
      continue;
    }
    if (consumedGroupIds.has(relation.groupId)) continue;
    consumedGroupIds.add(relation.groupId);
    blocks.push({
      key: relation.groupId,
      relation: relation.kind,
      requirements: requirements.filter(
        (candidate) => candidate.relation?.groupId === relation.groupId,
      ),
    });
  }

  return blocks;
}

function ExperienceLine({
  requirement,
  relationRole,
}: {
  requirement: JobExperienceRequirement;
  relationRole?: ExtendedRelation["role"];
}) {
  const t = useTranslations("jobs.experienceRequirement");
  const targetId = experienceEvidenceTargetId(requirement.id);
  const [jumpState, setJumpState] = useState<
    "IDLE" | "WAITING" | "UNAVAILABLE"
  >("IDLE");
  const retryTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    },
    [],
  );

  const viewInJd = () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setJumpState("WAITING");
    let attempts = 0;
    const findTarget = () => {
      if (focusExperienceEvidence(targetId)) {
        retryTimerRef.current = null;
        setJumpState("IDLE");
        return;
      }
      attempts += 1;
      if (attempts >= MAX_EVIDENCE_ATTEMPTS) {
        retryTimerRef.current = null;
        setJumpState("UNAVAILABLE");
        return;
      }
      retryTimerRef.current = window.setTimeout(findTarget, EVIDENCE_RETRY_MS);
    };
    findTarget();
  };
  const waiting = jumpState === "WAITING";
  const unavailable = jumpState === "UNAVAILABLE";
  const buttonLabel = waiting
    ? t("findingInJdLabel", { duration: requirement.years.text })
    : unavailable
      ? t("jdEvidenceUnavailableLabel", { duration: requirement.years.text })
      : t("viewInJdLabel", { duration: requirement.years.text });

  return (
    <div
      data-classification="REQUIRED"
      data-relation-role={relationRole}
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2",
        relationRole === "SUBSET" &&
          "ml-4 border-l border-brand-blue/25 pl-3 sm:ml-6",
      )}
    >
      <div className="flex min-w-0 flex-1 basis-40 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-base font-semibold leading-none tracking-tight tabular-nums text-foreground">
          {requirement.years.text}
        </span>
        {requirement.scope ? (
          <span className="min-w-0 break-words text-sm text-foreground/80">
            {requirement.scope}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        aria-controls={targetId}
        aria-label={buttonLabel}
        aria-busy={waiting}
        aria-live="polite"
        disabled={waiting}
        onClick={viewInJd}
        className="inline-flex h-8 [@media(any-pointer:coarse)]:min-h-11 shrink-0 items-center gap-1.5 self-start rounded-lg border border-border/70 bg-background/80 px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-brand-blue/30 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-75 sm:self-center motion-reduce:transition-none"
      >
        {waiting
          ? t("findingInJd")
          : unavailable
            ? t("jdEvidenceUnavailable")
            : t("viewInJd")}
        {waiting ? (
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-brand-blue motion-reduce:animate-none"
            aria-hidden
          />
        ) : unavailable ? (
          <CircleHelp className="h-3.5 w-3.5 text-brand-blue" aria-hidden />
        ) : (
          <ArrowDown className="h-3.5 w-3.5 text-brand-blue" aria-hidden />
        )}
      </button>
    </div>
  );
}

export function JobRequirementsPanel({
  experience,
  description,
}: {
  experience: VisibleJobExperienceProjection;
  description: string;
}) {
  const t = useTranslations("jobs.experienceRequirement");
  const headingId = useId();

  const requiredExperience = experience.requirements;
  const signals = useMemo(
    () => buildTechnicalSignals(description),
    [description],
  );

  if (!requiredExperience.length && !signals.length) return null;

  const blocks = buildRequirementBlocks(requiredExperience);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="jd-requirements-panel"
      className="@container"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center text-muted-foreground">
          <ListChecks className="h-4 w-4" aria-hidden />
        </span>
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {t("title")}
        </h3>
      </div>

      <div className={cn("mt-2 grid min-w-0 gap-2", blocks.length > 0 && signals.length > 0 && "@lg:grid-cols-2")}>
        {blocks.length ? (
          <div data-testid="jd-experience-row" data-requirement-family="experience" className="min-w-0 rounded-lg border border-brand-blue/15 bg-brand-blue/[0.035] px-3 py-3">
            {/* Keep the label above the content so long scopes cannot squeeze it. */}
            <div className="min-w-0 space-y-2">
              <h4 className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground/75">
                <CalendarClock
                  className="h-3.5 w-3.5 text-brand-blue"
                  aria-hidden
                />
                {t("experienceHeading")}
              </h4>
              <div className="min-w-0 space-y-2">
              {blocks.map((block) => (
                <div
                  key={block.key}
                  role={block.relation ? "group" : undefined}
                  aria-label={
                    block.relation
                      ? t(
                          block.relation === "ANY_OF"
                            ? "relationAnyOfLabel"
                            : "relationAllOfLabel",
                        )
                      : undefined
                  }
                  className="space-y-1"
                >
                  {block.requirements.map((requirement, index) => {
                    const relation = requirement.relation as
                      ExtendedRelation | undefined;
                    const relationRole = relation?.role;
                    const connectorKey =
                      relationRole === "SUBSET"
                        ? "relationIncludes"
                        : index > 0 && block.relation === "ANY_OF"
                          ? "relationAnyOf"
                          : index > 0 && block.relation === "ALL_OF"
                            ? "relationAllOf"
                            : null;
                    return (
                      <Fragment key={requirement.id}>
                        {connectorKey ? (
                          <span
                            className={cn(
                              "inline-flex text-xs font-medium text-muted-foreground",
                              relationRole === "SUBSET" && "ml-4 sm:ml-6",
                            )}
                          >
                            {t(connectorKey)}
                          </span>
                        ) : null}
                        <ExperienceLine
                          requirement={requirement}
                          relationRole={relationRole}
                        />
                      </Fragment>
                    );
                  })}
                </div>
              ))}
              </div>
            </div>
          </div>
        ) : null}

        {signals.length ? (
          <div
            className={cn(
              "min-w-0 rounded-lg border border-border/70 bg-muted/30 px-3 py-3",
            )}
          >
            <div className="min-w-0 space-y-2">
              <h4 className="shrink-0 text-xs font-semibold text-foreground/75">
                {t("technologyHeading")}
              </h4>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {signals.map((signal) => (
                <span
                  key={signal.skill}
                  data-testid="jd-skill-chip"
                  data-requirement-family="technology"
                  aria-label={signal.skill}
                  title={signal.evidence}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-medium",
                    signalTone(),
                  )}
                >
                  {signal.skill}
                </span>
              ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
