"use client";

import { Fragment, useId, type ElementType } from "react";
import {
  CalendarClock,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type {
  JobExperienceAnalysis,
  JobExperienceRequirement,
} from "@/lib/shared/jobExperienceAnalysis";
import { cn } from "@/lib/utils";

type RequirementTone = {
  icon: ElementType;
  card: string;
  badge: string;
  evidence: string;
};

const REQUIREMENT_TONES: Record<
  JobExperienceRequirement["classification"],
  RequirementTone
> = {
  REQUIRED: {
    // This describes the JD, not the candidate's result. A checkmark would
    // falsely imply the requirement has already been satisfied.
    icon: CircleAlert,
    card:
      "border-amber-300/80 bg-amber-50/90 text-amber-950 dark:border-amber-300/35 dark:bg-amber-400/[0.12] dark:text-amber-50",
    badge:
      "border-amber-400/70 bg-amber-100 text-amber-900 dark:border-amber-300/40 dark:bg-amber-300/15 dark:text-amber-100",
    evidence:
      "border-amber-300/60 bg-amber-50/70 dark:border-amber-300/25 dark:bg-amber-400/[0.08]",
  },
  PREFERRED: {
    icon: Sparkles,
    card:
      "border-sky-300/80 bg-sky-50/90 text-sky-950 dark:border-sky-300/35 dark:bg-sky-400/[0.12] dark:text-sky-50",
    badge:
      "border-sky-400/70 bg-sky-100 text-sky-900 dark:border-sky-300/40 dark:bg-sky-300/15 dark:text-sky-100",
    evidence:
      "border-sky-300/60 bg-sky-50/70 dark:border-sky-300/25 dark:bg-sky-400/[0.08]",
  },
  REVIEW: {
    icon: CircleHelp,
    card:
      "border-border bg-muted/45 text-foreground dark:border-border/80 dark:bg-muted/30",
    badge:
      "border-border bg-background/80 text-foreground/80 dark:bg-background/50",
    evidence: "border-border/80 bg-background/65 dark:bg-background/35",
  },
};

const CLASSIFICATION_LABEL_KEYS = {
  REQUIRED: "classificationREQUIRED",
  PREFERRED: "classificationPREFERRED",
  REVIEW: "classificationREVIEW",
} as const satisfies Record<
  JobExperienceRequirement["classification"],
  "classificationREQUIRED" | "classificationPREFERRED" | "classificationREVIEW"
>;

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

    const members = requirements.filter(
      (candidate) => candidate.relation?.groupId === relation.groupId,
    );
    blocks.push({
      key: relation.groupId,
      relation: relation.kind,
      requirements: members,
    });
  }

  return blocks;
}

function RequirementCard({
  requirement,
}: {
  requirement: JobExperienceRequirement;
}) {
  const t = useTranslations("jobs.experienceRequirement");
  const tone = REQUIREMENT_TONES[requirement.classification];
  const ClassificationIcon = tone.icon;

  return (
    <article
      className={cn(
        "min-w-0 rounded-xl border p-3 shadow-sm",
        tone.card,
      )}
      data-classification={requirement.classification}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em]",
                tone.badge,
              )}
            >
              <ClassificationIcon className="h-3 w-3" aria-hidden />
              {t(CLASSIFICATION_LABEL_KEYS[requirement.classification])}
            </span>
            <strong className="text-base font-extrabold leading-tight tabular-nums">
              {requirement.classification === "REVIEW"
                ? t("reviewWording")
                : requirement.years.text}
            </strong>
          </div>
          {requirement.scope ? (
            <p className="mt-1.5 break-words text-xs font-medium leading-relaxed opacity-85">
              {t("scope", { scope: requirement.scope })}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] opacity-70">
          {t("source")}
        </span>
      </div>

      <details className={cn("group/evidence mt-2 rounded-lg border", tone.evidence)}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
          <span>{t("viewEvidence")}</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform duration-200 group-open/evidence:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>
        <blockquote className="mx-3 mb-3 break-words border-l-2 border-current/35 pl-3 text-xs leading-relaxed opacity-90">
          {requirement.evidence.text}
        </blockquote>
      </details>
    </article>
  );
}

export function ExperienceRequirementSummary({
  analysis,
}: {
  analysis?: JobExperienceAnalysis | null;
}) {
  const t = useTranslations("jobs.experienceRequirement");
  const headingId = useId();
  const requirements = analysis?.requirements ?? [];
  const truncated = analysis?.truncated === true;
  if (!requirements.length && !truncated) return null;

  const blocks = buildRequirementBlocks(requirements);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-border/70 bg-gradient-to-br from-background via-background to-muted/30 p-3.5 shadow-sm"
      data-testid="experience-requirement-summary"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-900 ring-1 ring-amber-300/80 dark:bg-amber-300/15 dark:text-amber-100 dark:ring-amber-300/35">
          <CalendarClock className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-bold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {truncated ? (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50/80 px-3 py-2 text-xs font-medium leading-relaxed text-amber-950 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-50"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t("truncated")}</span>
        </p>
      ) : null}

      {requirements.length ? (
        <div className="mt-3 space-y-3">
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
              className="space-y-2"
            >
              {block.requirements.map((requirement, index) => (
                <Fragment key={requirement.id}>
                  {index > 0 && block.relation ? (
                    <div className="flex items-center gap-2" aria-hidden="true">
                      <span className="h-px flex-1 bg-border/80" />
                      <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-extrabold tracking-[0.12em] text-muted-foreground">
                        {t(
                          block.relation === "ANY_OF"
                            ? "relationAnyOf"
                            : "relationAllOf",
                        )}
                      </span>
                      <span className="h-px flex-1 bg-border/80" />
                    </div>
                  ) : null}
                  <RequirementCard requirement={requirement} />
                </Fragment>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
