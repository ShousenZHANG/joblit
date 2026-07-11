"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Circle } from "lucide-react";
import { useTranslations } from "next-intl";

type GenerateProgressProps = {
  target: "resume" | "cover";
};

const STEP_DELAYS = [0, 700, 1800, 3200];

export function GenerateProgress({ target }: GenerateProgressProps) {
  const t = useTranslations("jobs.external");
  const STEPS = [
    { label: t("phaseValidating"), delay: STEP_DELAYS[0] },
    { label: t("phaseProcessing"), delay: STEP_DELAYS[1] },
    { label: t("phaseRendering"), delay: STEP_DELAYS[2] },
    { label: t("phaseCompiling"), delay: STEP_DELAYS[3] },
  ];
  const [elapsed, setElapsed] = useState(0);
  // useState lazy initializer is allowed to be impure and runs only once.
  const [start] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - start), 120);
    return () => clearInterval(id);
  }, [start]);

  // Illustrative step sequence. The LAST step stays in-progress until the real
  // completion event swaps this whole phase out for the review dialog — so we
  // never show a fake percentage that stalls or lies about progress.
  const activeStepIndex = Math.min(
    STEPS.length - 1,
    Math.max(0, STEPS.findLastIndex((s) => elapsed >= s.delay)),
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Title */}
        <h3 className="text-center text-base font-semibold text-foreground">
          {target === "resume"
            ? t("generatingResumeTitle")
            : t("generatingCoverTitle")}
        </h3>

        {/* Step list */}
        <div className="space-y-2.5">
          {STEPS.map((step, idx) => {
            const isDone = idx < activeStepIndex;
            const isActive = idx === activeStepIndex;
            return (
              <div key={step.label} className="flex items-center gap-2.5 text-sm">
                {isDone ? (
                  <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-brand-emerald-500" />
                ) : isActive ? (
                  <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin text-brand-emerald-500 motion-reduce:animate-none" />
                ) : (
                  <Circle className="h-4.5 w-4.5 shrink-0 text-muted-foreground/40" />
                )}
                <span
                  className={
                    isDone
                      ? "text-brand-emerald-text"
                      : isActive
                        ? "font-medium text-foreground"
                        : "text-muted-foreground/70"
                  }
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Indeterminate shimmer — communicates "working" honestly without a
            fake percentage that could stall partway. */}
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={t("progressAriaLabel")}
        >
          <div className="progress-indeterminate h-full w-1/3 rounded-full bg-brand-emerald-500 motion-reduce:w-full motion-reduce:animate-none" />
        </div>

        {/* Hint */}
        <p className="text-center text-xs text-muted-foreground">
          {elapsed > 8000 ? t("hintStillWorking") : t("hintUsualDuration")}
        </p>
      </div>
    </div>
  );
}
