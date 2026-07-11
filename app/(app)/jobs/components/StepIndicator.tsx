"use client";

import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

type StepDef = {
  id: 1 | 2 | 3;
  label: string;
  subtitle: string;
};

export type DialogPhase = 1 | 2 | 3 | "generating";

type StepIndicatorProps = {
  currentStep: DialogPhase;
  onStepClick: (step: 1 | 2 | 3) => void;
  canGoToStep2: boolean;
  canGoToStep3: boolean;
};

function numericStep(phase: DialogPhase): number {
  if (phase === "generating") return 4;
  return phase;
}

export function StepIndicator({
  currentStep,
  onStepClick,
  canGoToStep2,
  canGoToStep3,
}: StepIndicatorProps) {
  const t = useTranslations("jobs.external");
  const current = numericStep(currentStep);

  const STEPS: StepDef[] = [
    { id: 1, label: t("stepImportLabel"), subtitle: t("stepImportSubtitle") },
    { id: 2, label: t("stepCopyLabel"), subtitle: t("stepCopySubtitle") },
    { id: 3, label: t("stepGenerateLabel"), subtitle: t("stepGenerateSubtitle") },
  ];

  return (
    <div className="flex items-start gap-0 px-2 py-1">
      {STEPS.map((step, idx) => {
        const isDone = current > step.id;
        const isActive = current === step.id;
        const canClick =
          step.id === 1 ||
          (step.id === 2 && canGoToStep2) ||
          (step.id === 3 && canGoToStep3);
        const isGeneratingOrDone = current > 3;
        const clickable = canClick && !isDone && !isGeneratingOrDone;

        return (
          <div key={step.id} className="flex flex-1 items-start">
            {/* Connector line before (except first) */}
            {idx > 0 && (
              <div className="mt-4 flex-1 px-1">
                <div
                  className={[
                    "h-0.5 w-full rounded-full transition-colors duration-500",
                    current > step.id || (current === step.id && idx > 0)
                      ? "bg-brand-emerald-400"
                      : "bg-border",
                  ].join(" ")}
                />
              </div>
            )}

            {/* Step circle + labels */}
            <button
              type="button"
              onClick={() => clickable && onStepClick(step.id)}
              disabled={!clickable}
              className="flex flex-col items-center gap-1 disabled:cursor-default"
            >
              <div
                className={[
                  "relative flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
                  isDone
                    ? "bg-brand-emerald-500 text-white shadow-sm"
                    : isActive
                      ? "border-2 border-brand-emerald-500 bg-brand-emerald-50 text-brand-emerald-text"
                      : "border border-border bg-card text-muted-foreground/70",
                ].join(" ")}
              >
                {isDone ? (
                  <CheckCircle2 className="h-4.5 w-4.5" />
                ) : (
                  step.id
                )}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute -inset-1 rounded-full ring-2 ring-emerald-400/40 animate-pulse motion-reduce:animate-none"
                  />
                )}
              </div>
              <span
                className={[
                  "text-[11px] font-semibold leading-tight",
                  isDone
                    ? "text-brand-emerald-text"
                    : isActive
                      ? "text-brand-emerald-800"
                      : "text-muted-foreground/70",
                ].join(" ")}
              >
                {step.label}
              </span>
              <span className="hidden text-[10px] leading-tight text-muted-foreground/70 sm:block">
                {step.subtitle}
              </span>
            </button>

            {/* Connector line after (except last) */}
            {idx < STEPS.length - 1 && (
              <div className="mt-4 flex-1 px-1">
                <div
                  className={[
                    "h-0.5 w-full rounded-full transition-colors duration-500",
                    current > step.id + 1 || (current === step.id + 1)
                      ? "bg-brand-emerald-400"
                      : "bg-border",
                  ].join(" ")}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
