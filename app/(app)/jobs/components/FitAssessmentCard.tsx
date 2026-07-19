"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  CircleHelp,
  Cpu,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type {
  FitJudgement,
  FitMatrix,
} from "@/lib/shared/schemas/fitMatrix";
import {
  analyzeJobTechnicalRequirements,
  type TechnicalRequirement,
} from "@/lib/shared/jdTechnicalAnalysis";
import { extractSkills } from "@/lib/shared/skillsGazetteer";
import { cn } from "@/lib/utils";
import { parseExperienceGate } from "../utils/experienceParser";

type DisplayTier = "GATE" | "CORE" | "PREFERRED";

type TechnicalSignal = TechnicalRequirement & {
  tier: DisplayTier;
  judgement?: FitJudgement;
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
      JUDGEMENT_SEVERITY[judgement] >
        JUDGEMENT_SEVERITY[selected]
    ) {
      selected = judgement;
    }
  }
  return selected;
}

export function buildTechnicalSignals(
  description: string,
  matrix: FitMatrix | null,
): TechnicalSignal[] {
  return analyzeJobTechnicalRequirements(description)
    .filter((requirement) => requirement.priority !== "MENTIONED")
    .slice(0, 12)
    .map((requirement) => ({
      ...requirement,
      tier: requirement.isGate
        ? "GATE"
        : requirement.priority === "PREFERRED"
          ? "PREFERRED"
          : "CORE",
      judgement: judgementForSkill(requirement.skill, matrix),
    }));
}

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

function SignalChip({
  signal,
}: {
  signal: TechnicalSignal;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        signalTone(signal.judgement),
      )}
      title={signal.evidence}
    >
      {signal.judgement === "MATCH" ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden />
      ) : signal.judgement === "GAP" ? (
        <TriangleAlert className="h-3 w-3" aria-hidden />
      ) : signal.judgement === "PARTIAL" ||
        signal.judgement === "UNKNOWN" ? (
        <CircleHelp className="h-3 w-3" aria-hidden />
      ) : null}
      <span>{signal.skill}</span>
      {signal.judgement && signal.judgement !== "MATCH" ? (
        <span className="text-[9px] font-bold uppercase tracking-wide opacity-80">
          {signal.judgement}
        </span>
      ) : null}
    </span>
  );
}

export function FitAssessmentCard({
  description,
  score,
  verdict,
  eligibility,
  matrix,
}: {
  description: string;
  score?: number | null;
  verdict?: string | null;
  eligibility?: string | null;
  matrix: FitMatrix | null;
}) {
  const t = useTranslations("jobs.fitAssessment");
  const technicalSignals = useMemo(
    () => buildTechnicalSignals(description, matrix),
    [description, matrix],
  );
  const structuralGates = useMemo(
    () => parseExperienceGate(description),
    [description],
  );
  const gateRequirements = matrix?.requirements.filter(
    (requirement) => requirement.criticality === "GATE",
  ) ?? [];
  const gateGaps = gateRequirements.filter(
    (requirement) => requirement.judgement !== "MATCH",
  );
  const coreGaps = matrix?.requirements
    .filter(
      (requirement) =>
        requirement.criticality !== "GATE" &&
        requirement.judgement === "GAP" &&
        (requirement.criticality === "CORE" ||
          requirement.type === "REQUIRED" ||
          requirement.type === "RESPONSIBILITY"),
    )
    .slice(0, 3) ?? [];
  const effectiveEligibility =
    eligibility ?? matrix?.eligibility.status ?? null;
  const blocked =
    effectiveEligibility === "BLOCK" ||
    gateRequirements.some((requirement) => requirement.judgement === "GAP");
  const review =
    !blocked &&
    (effectiveEligibility === "RISK" ||
      gateRequirements.some(
        (requirement) =>
          requirement.judgement === "PARTIAL" ||
          requirement.judgement === "UNKNOWN",
      ));
  const hasScore = typeof score === "number";
  const hasGateAssessment = Boolean(matrix) || Boolean(effectiveEligibility);

  if (
    !technicalSignals.length &&
    !structuralGates.length &&
    !hasScore &&
    !hasGateAssessment
  ) {
    return null;
  }

  const grouped = {
    GATE: technicalSignals.filter((signal) => signal.tier === "GATE"),
    CORE: technicalSignals.filter((signal) => signal.tier === "CORE"),
    PREFERRED: technicalSignals.filter(
      (signal) => signal.tier === "PREFERRED",
    ),
  } satisfies Record<DisplayTier, TechnicalSignal[]>;

  return (
    <section
      aria-labelledby="fit-assessment-heading"
      className="rounded-2xl border border-border/70 bg-gradient-to-br from-background to-muted/25 p-3.5 shadow-[0_12px_32px_-28px_rgba(15,23,42,0.45)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 text-brand-emerald-text ring-1 ring-brand-emerald-100 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300">
            <Cpu className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3
              id="fit-assessment-heading"
              className="text-xs font-bold uppercase tracking-wider text-foreground"
            >
              {t("title")}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {hasScore ? (
            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-bold text-foreground">
              {score}/100{verdict ? ` · ${verdict}` : ""}
            </span>
          ) : null}
          {hasGateAssessment ? (
            <span
              role="status"
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                blocked
                  ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300"
                  : review
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300"
                    : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300",
              )}
            >
              {blocked ? (
                <TriangleAlert className="h-3 w-3" aria-hidden />
              ) : review ? (
                <CircleHelp className="h-3 w-3" aria-hidden />
              ) : (
                <CheckCircle2 className="h-3 w-3" aria-hidden />
              )}
              {blocked
                ? t("gateBlocked")
                : review
                  ? t("gateReview")
                  : t("gateClear")}
            </span>
          ) : null}
        </div>
      </div>

      {(["GATE", "CORE", "PREFERRED"] as const).map((tier) =>
        grouped[tier].length ? (
          <div key={tier} className="mt-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {t(`tier${tier}`)}
              </span>
              <span className="h-px flex-1 bg-border/60" aria-hidden />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {grouped[tier].map((signal) => (
                <SignalChip key={signal.skill} signal={signal} />
              ))}
            </div>
          </div>
        ) : null,
      )}

      {structuralGates.length ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <ShieldAlert className="h-3 w-3" aria-hidden />
            {t("screeningGates")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {structuralGates.map((signal) => (
              <span
                key={signal.key}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  signal.isRequired
                    ? "border-rose-300/60 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300"
                    : "border-border bg-background text-foreground/70",
                )}
                title={signal.evidence}
              >
                {signal.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {gateGaps.length || coreGaps.length ? (
        <div
          className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2"
          aria-live="polite"
        >
          {gateGaps.length ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/70 p-2.5 dark:border-rose-400/20 dark:bg-rose-500/[0.06]">
              <div className="text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                {t("gateGaps")}
              </div>
              <ul className="mt-1 space-y-1 text-xs text-rose-800 dark:text-rose-200">
                {gateGaps.slice(0, 3).map((requirement) => (
                  <li key={requirement.id}>
                    {requirement.requirement} · {requirement.judgement}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {coreGaps.length ? (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-2.5 dark:border-amber-400/20 dark:bg-amber-500/[0.06]">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {t("coreGaps")}
              </div>
              <ul className="mt-1 space-y-1 text-xs text-amber-800 dark:text-amber-200">
                {coreGaps.map((requirement) => (
                  <li key={requirement.id}>{requirement.requirement}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
