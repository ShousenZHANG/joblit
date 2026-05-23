"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronDown, Loader2, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useFetchStatus } from "./FetchStatusContext";

// Fetch progress panel — bottom-right floating surface that tracks a
// fetch run through queued → running → done. Supports three visual
// modes:
//   1. expanded card (full status + query chips + cancel)
//   2. minimized to a FAB (progress ring, click to reopen)
//   3. hidden (runId null)
// Theme-token chrome so light and dark render cleanly. Motion is
// framer-motion spring for the card, Loader2 spin for the running
// spinner, and the existing CSS keyframes for progress shimmer.

const SPRING = {
  type: "spring" as const,
  stiffness: 320,
  damping: 28,
  mass: 0.6,
};

export function FetchProgressPanel() {
  const {
    runId,
    status,
    importedCount,
    error,
    queryTitle,
    queryTerms,
    smartExpand,
    elapsedSeconds,
    open,
    setOpen,
    cancelRun,
  } = useFetchStatus();

  const isRunning = status === "RUNNING" || status === "QUEUED";
  const progressValue =
    status === "SUCCEEDED"
      ? 100
      : status === "FAILED"
        ? 0
        : status === "RUNNING"
          ? Math.min(92, 20 + Math.floor(elapsedSeconds * 2))
          : 10;

  const statusLabel =
    status === "RUNNING"
      ? "Running"
      : status === "QUEUED"
        ? "Queued"
        : status === "SUCCEEDED"
          ? "Completed"
          : status === "FAILED"
            ? "Failed"
            : "Starting";

  const statusTone =
    status === "FAILED"
      ? "bg-destructive/10 text-destructive"
      : status === "SUCCEEDED"
        ? "bg-brand-emerald-100 text-brand-emerald-700"
        : status === "RUNNING"
          ? "bg-[theme(colors.tier-good-bg)] text-[theme(colors.tier-good-fg)]"
          : "bg-muted text-muted-foreground";

  const shownTerms = queryTerms.slice(0, 6);
  const hiddenTerms = Math.max(0, queryTerms.length - shownTerms.length);

  const circumference = 2 * Math.PI * 22;
  const strokeDashoffset =
    circumference - (progressValue / 100) * circumference;

  if (!runId) return null;

  return (
    <AnimatePresence mode="wait">
      {!open ? (
        <motion.button
          key="fab"
          type="button"
          initial={{ opacity: 0, scale: 0.85, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: 12 }}
          transition={SPRING}
          onClick={() => setOpen(true)}
          aria-label="Open fetch progress"
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-background/95 shadow-lg backdrop-blur transition-shadow hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-500"
        >
          <svg className="h-11 w-11 -rotate-90" viewBox="0 0 48 48">
            <circle
              cx="24"
              cy="24"
              r="22"
              fill="none"
              stroke="var(--color-muted, #e2e8f0)"
              strokeWidth="3"
            />
            <motion.circle
              cx="24"
              cy="24"
              r="22"
              fill="none"
              stroke={
                status === "FAILED"
                  ? "var(--color-destructive, #ef4444)"
                  : "var(--color-brand-emerald-500, #10b981)"
              }
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              animate={{ strokeDashoffset }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <span className="absolute text-[10px] font-bold text-foreground">
            {status === "SUCCEEDED"
              ? "\u2713"
              : status === "FAILED"
                ? "\u2715"
                : `${progressValue}%`}
          </span>
          {isRunning && (
            <span className="pointer-events-none absolute inset-0 animate-ping rounded-full border-2 border-brand-emerald-400 opacity-20" />
          )}
        </motion.button>
      ) : (
        <motion.div
          key="panel"
          role="dialog"
          aria-label="Fetch progress"
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16 }}
          transition={SPRING}
          className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-border/60 bg-background/95 shadow-[0_28px_60px_-24px_rgba(15,23,42,0.22)] backdrop-blur-xl"
        >
          {/* Header — title, status chip, minimize, close */}
          <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {isRunning ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-brand-emerald-600"
                  aria-hidden
                />
              ) : status === "SUCCEEDED" ? (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-brand-emerald-600"
                  aria-hidden
                />
              ) : null}
              <div className="truncate text-sm font-semibold text-foreground">
                Fetch progress
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  statusTone,
                )}
              >
                {statusLabel}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-500"
                aria-label="Minimize"
                title="Minimize"
              >
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              {!isRunning ? (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                  aria-label="Close"
                  title="Close"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-3 px-4 py-4">
            {/* Step indicator */}
            <StepIndicator status={status} />

            {/* Status line */}
            <div className="text-xs text-muted-foreground">
              {status === "RUNNING"
                ? "Collecting and importing results…"
                : status === "SUCCEEDED"
                  ? "Completed successfully."
                  : status === "FAILED"
                    ? "Fetch failed or cancelled."
                    : "Queued and starting soon."}
            </div>

            {/* Query terms panel */}
            {queryTerms.length ? (
              <div className="rounded-xl border border-border/60 bg-muted/40 p-3">
                <div className="text-[11px] text-muted-foreground">
                  {smartExpand && queryTitle
                    ? `Smart fetch expanded "${queryTitle}" into ${queryTerms.length} role queries.`
                    : `Role queries in this run (${queryTerms.length}).`}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {shownTerms.map((term) => (
                    <span
                      key={term}
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground/85"
                    >
                      {term}
                    </span>
                  ))}
                  {hiddenTerms ? (
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                      +{hiddenTerms} more
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Progress bar */}
            <div className="space-y-1.5">
              <Progress
                value={progressValue}
                className="h-2 bg-brand-emerald-100/60"
                indicatorClassName={cn(
                  "bg-gradient-to-r from-brand-emerald-500 to-brand-emerald-600 shadow-[0_0_10px_rgba(16,185,129,0.4)] transition-all duration-500 ease-out",
                  status === "FAILED" &&
                    "from-destructive to-destructive bg-destructive",
                )}
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span className="font-medium text-foreground/80">
                  {progressValue}%
                </span>
                <span>Elapsed {elapsedSeconds}s</span>
              </div>
            </div>

            {/* Success / error footer */}
            {status === "SUCCEEDED" ? (
              <>
                <div className="relative overflow-hidden rounded-lg bg-brand-emerald-50/60 py-3 text-center">
                  <ConfettiDots />
                  <div className="text-sm font-semibold text-brand-emerald-700">
                    Imported {importedCount} new jobs
                  </div>
                </div>
                <Button
                  className="h-10 w-full rounded-full bg-brand-emerald-600 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-emerald-700"
                  onClick={() => setOpen(false)}
                  asChild
                >
                  <a href="/jobs">View Jobs</a>
                </Button>
              </>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {isRunning ? (
              <Button
                variant="outline"
                className="h-10 w-full rounded-full border-destructive/30 bg-destructive/5 text-[13px] font-semibold text-destructive shadow-sm transition-colors hover:border-destructive/50 hover:bg-destructive/15 hover:text-destructive"
                onClick={cancelRun}
              >
                Cancel fetch
              </Button>
            ) : null}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StepIndicator({ status }: { status: string | null }) {
  const steps = [
    {
      label: "Queued",
      done: status !== "QUEUED",
      active: status === "QUEUED",
    },
    {
      label: "Fetching",
      done: status === "SUCCEEDED" || status === "FAILED",
      active: status === "RUNNING",
    },
    {
      label: "Done",
      done: status === "SUCCEEDED",
      active: false,
    },
  ];

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => (
        <React.Fragment key={step.label}>
          <div className="flex min-w-0 flex-col items-center gap-1">
            <motion.div
              animate={{
                scale: step.active ? 1.08 : 1,
              }}
              transition={{ duration: 0.5, repeat: step.active ? Infinity : 0, repeatType: "reverse" }}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
                step.done
                  ? "bg-brand-emerald-500 text-white"
                  : step.active
                    ? "bg-[theme(colors.tier-good-fg)] text-white"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {step.done ? <ChevronDown className="h-3 w-3 rotate-[-135deg]" strokeWidth={3} aria-hidden /> : i + 1}
            </motion.div>
            <span className="text-[10px] font-medium text-muted-foreground">
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className="relative mb-4 h-0.5 flex-1 overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={false}
                animate={{ width: step.done ? "100%" : "0%" }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-y-0 left-0 bg-brand-emerald-500"
              />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function ConfettiDots() {
  const dots = [
    { color: "bg-brand-emerald-400", x: -30, delay: "0ms" },
    { color: "bg-[theme(colors.tier-good-fg)]", x: 20, delay: "100ms" },
    { color: "bg-[theme(colors.tier-fair-fg)]", x: -15, delay: "200ms" },
    { color: "bg-destructive", x: 35, delay: "50ms" },
    { color: "bg-brand-emerald-300", x: 10, delay: "250ms" },
    { color: "bg-brand-emerald-500", x: -40, delay: "150ms" },
  ];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
      {dots.map((dot, i) => (
        <span
          key={i}
          className={`absolute h-1.5 w-1.5 rounded-full ${dot.color} animate-confetti-pop`}
          style={
            {
              "--confetti-x": `${dot.x}px`,
              animationDelay: dot.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
