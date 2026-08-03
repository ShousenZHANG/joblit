"use client";

import { Fragment, useId, useMemo } from "react";
import { CalendarClock, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import type {
  JobExperienceAnalysis,
  JobExperienceRequirement,
} from "@/lib/shared/jobExperienceAnalysis";
import type { FitJudgement, FitMatrix } from "@/lib/shared/schemas/fitMatrix";
import {
  analyzeJobTechnicalRequirements,
  type TechnicalRequirement,
} from "@/lib/shared/jdTechnicalAnalysis";
import { extractSkills } from "@/lib/shared/skillsGazetteer";
import { cn } from "@/lib/utils";

/**
 * The single quiet block under "Job description": what this job asks for,
 * and nothing else.
 *
 * It replaced two stacked cards (an experience card and a five-section
 * "Fit evidence" card). The rules that shaped it:
 *
 * - Only confident experience findings render. A REVIEW candidate is a guess
 *   ("3 years' service" in a leave policy once rendered as a requirement
 *   card), and a guess shown prominently costs more trust than it earns.
 * - Technology is one flat cluster. The GATE / CORE / PREFERRED tiers still
 *   exist in the data and drive ordering (gates first), but three labelled
 *   sections told the reader to study a taxonomy before reading chips.
 * - Screening gates, nice-to-have, category dots and the legend are gone by
 *   product decision — the JD text below carries them.
 * - A job with no detectable asks renders nothing. Prominence comes from
 *   appearing only when there is something to say.
 */

type TechnicalSignal = TechnicalRequirement & {
  judgement?: FitJudgement;
};

const TIER_ORDER: Record<string, number> = {
  REQUIRED: 0,
  PREFERRED: 1,
};

const JUDGEMENT_SEVERITY: Record<FitJudgement, number> = {
  GAP: 4,
  UNKNOWN: 3,
  PARTIAL: 2,
  MATCH: 1,
};

function judgementForSkill(
  skill: string,
  matrix: FitMatrix | null,
): FitJudgement | undefined {
  let selected: FitJudgement | undefined;
  for (const requirement of matrix?.requirements ?? []) {
    const requirementSkills = extractSkills(requirement.requirement);
    if (!requirementSkills.has(skill)) continue;
    const judgement = requirement.judgement;
    if (
      judgement === "MATCH" &&
      requirementSkills.size > 1 &&
      /\bor\b/i.test(requirement.requirement)
    ) {
      const evidencedSkills = extractSkills(
        requirement.candidateEvidence ?? requirement.evidence ?? "",
      );
      if (!evidencedSkills.has(skill)) continue;
    }
    if (
      !selected ||
      JUDGEMENT_SEVERITY[judgement] > JUDGEMENT_SEVERITY[selected]
    ) {
      selected = judgement;
    }
  }
  return selected;
}

/** Gate-tier skills first, then core, then preferred — one flat cluster. */
export function buildTechnicalSignals(
  description: string,
  matrix: FitMatrix | null,
): TechnicalSignal[] {
  return analyzeJobTechnicalRequirements(description)
    .filter((requirement) => requirement.priority !== "MENTIONED")
    .sort((a, b) => {
      if (a.isGate !== b.isGate) return a.isGate ? -1 : 1;
      return (
        (TIER_ORDER[a.priority] ?? 2) - (TIER_ORDER[b.priority] ?? 2)
      );
    })
    .slice(0, 12)
    .map((requirement) => ({
      ...requirement,
      judgement: judgementForSkill(requirement.skill, matrix),
    }));
}

/** Fill carries the scan judgement; unscored chips stay neutral. */
function signalTone(judgement?: FitJudgement): string {
  switch (judgement) {
    case "MATCH":
      return "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "GAP":
      return "border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300";
    case "PARTIAL":
    case "UNKNOWN":
      return "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300";
    default:
      return "border-border/70 bg-background/80 text-foreground/75";
  }
}

type RequirementBlock = {
  key: string;
  relation: "ANY_OF" | "ALL_OF" | null;
  requirements: JobExperienceRequirement[];
};

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
}: {
  requirement: JobExperienceRequirement;
}) {
  const t = useTranslations("jobs.experienceRequirement");
  const required = requirement.classification === "REQUIRED";

  return (
    <div data-classification={requirement.classification}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="text-base font-bold leading-tight tabular-nums text-foreground">
          {requirement.years.text}
        </strong>
        {requirement.scope ? (
          <span className="text-sm text-muted-foreground">
            · {requirement.scope}
          </span>
        ) : null}
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-[0.1em]",
            required
              ? "text-amber-700 dark:text-amber-300"
              : "text-muted-foreground",
          )}
        >
          {t(required ? "classificationREQUIRED" : "classificationPREFERRED")}
        </span>
      </div>
      <details className="group/evidence mt-1">
        <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {t("viewEvidence")}
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform duration-200 group-open/evidence:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>
        <blockquote className="mt-1 break-words border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          {requirement.evidence.text}
        </blockquote>
      </details>
    </div>
  );
}

export function JobRequirementsPanel({
  analysis,
  description,
  matrix,
}: {
  analysis?: JobExperienceAnalysis | null;
  description: string;
  matrix: FitMatrix | null;
}) {
  const t = useTranslations("jobs.experienceRequirement");
  const headingId = useId();

  // A REVIEW finding is a low-confidence guess; it never renders.
  const confident = (analysis?.requirements ?? []).filter(
    (requirement) => requirement.classification !== "REVIEW",
  );
  const signals = useMemo(
    () => buildTechnicalSignals(description, matrix),
    [description, matrix],
  );

  if (!confident.length && !signals.length) return null;

  const blocks = buildRequirementBlocks(confident);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="jd-requirements-panel"
      className="rounded-2xl border border-border/60 bg-muted/20 p-3.5"
    >
      <h3 id={headingId} className="sr-only">
        {t("title")}
      </h3>

      {blocks.length ? (
        <div className="flex items-start gap-2.5">
          <CalendarClock
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0 flex-1 space-y-2">
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
                className="space-y-1.5"
              >
                {block.requirements.map((requirement, index) => (
                  <Fragment key={requirement.id}>
                    {index > 0 && block.relation ? (
                      <span className="inline-block rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        {t(
                          block.relation === "ANY_OF"
                            ? "relationAnyOf"
                            : "relationAllOf",
                        )}
                      </span>
                    ) : null}
                    <ExperienceLine requirement={requirement} />
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {signals.length ? (
        <div
          className={cn(
            "flex flex-wrap gap-1.5",
            blocks.length ? "mt-3 border-t border-border/50 pt-3" : undefined,
          )}
        >
          {signals.map((signal) => (
            <span
              key={signal.skill}
              data-testid="jd-skill-chip"
              title={signal.evidence}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                signalTone(signal.judgement),
              )}
            >
              {signal.skill}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
