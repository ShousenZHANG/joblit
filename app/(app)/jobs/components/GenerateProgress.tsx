"use client";

import { useEffect, useState, useRef } from "react";
import { CheckCircle2, Loader2, Circle } from "lucide-react";

type GenerateProgressProps = {
  target: "resume" | "cover";
  isComplete: boolean;
};

const STEPS = [
  { label: "Validating JSON structure", delay: 0 },
  { label: "Processing content", delay: 600 },
  { label: "Rendering template", delay: 1400 },
  { label: "Compiling PDF", delay: 2800 },
];

const PROGRESS_KEYFRAMES = [
  { time: 0, value: 5 },
  { time: 500, value: 25 },
  { time: 1200, value: 50 },
  { time: 2500, value: 75 },
  { time: 4000, value: 82 },
];

export function GenerateProgress({ target, isComplete }: GenerateProgressProps) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (isComplete) return;
    const id = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [isComplete]);

  const activeStepIndex = isComplete
    ? STEPS.length
    : STEPS.findLastIndex((s) => elapsed >= s.delay);

  const progress = isComplete
    ? 100
    : (() => {
        for (let i = PROGRESS_KEYFRAMES.length - 1; i >= 0; i--) {
          if (elapsed >= PROGRESS_KEYFRAMES[i].time) return PROGRESS_KEYFRAMES[i].value;
        }
        return 0;
      })();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Title */}
        <h3 className="text-center text-base font-semibold text-foreground">
          {isComplete
            ? target === "resume"
              ? "Resume PDF ready!"
              : "Cover Letter ready!"
            : target === "resume"
              ? "Generating your Resume PDF"
              : "Generating your Cover Letter"}
        </h3>

        {/* Step list */}
        <div className="space-y-2.5">
          {STEPS.map((step, idx) => {
            const isDone = idx < activeStepIndex;
            const isActive = idx === activeStepIndex && !isComplete;
            return (
              <div
                key={step.label}
                className="flex items-center gap-2.5 text-sm"
              >
                {isDone ? (
                  <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-brand-emerald-500" />
                ) : isActive ? (
                  <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin text-brand-emerald-500" />
                ) : (
                  <Circle className="h-4.5 w-4.5 shrink-0 text-slate-300" />
                )}
                <span
                  className={
                    isDone
                      ? "text-brand-emerald-700"
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

        {/* Progress bar */}
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand-emerald-500 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Hint */}
        {!isComplete && (
          <p className="text-center text-xs text-muted-foreground">
            {elapsed > 8000
              ? "Still working... this may take a bit longer"
              : "This usually takes 5\u201310 seconds"}
          </p>
        )}
      </div>
    </div>
  );
}
