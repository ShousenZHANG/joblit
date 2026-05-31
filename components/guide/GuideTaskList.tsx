"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ONBOARDING_TASKS,
  type OnboardingChecklist,
  type OnboardingTask,
  type OnboardingTaskId,
} from "@/lib/onboarding";
import { TASK_ICONS, TASK_MINUTES } from "./guideMeta";

interface GuideTaskListProps {
  checklist: OnboardingChecklist;
  activeTaskId: OnboardingTaskId | null;
  onNavigate: (task: OnboardingTask) => void;
}

/**
 * The Quick Start checklist rendered as a vertical journey timeline: a
 * connector rail links the step dots, the current step is elevated with an
 * emerald-tinted card + focus ring + primary CTA, completed steps collapse to
 * a checked title, and upcoming steps are tappable previews with a time chip.
 * Only the current step exposes the "Take me there" button so the guided path
 * stays unambiguous.
 */
export function GuideTaskList({ checklist, activeTaskId, onNavigate }: GuideTaskListProps) {
  const t = useTranslations("guide");
  return (
    <ol className="flex-1 overflow-y-auto px-5 py-4" data-testid="guide-quickstart-list">
      {ONBOARDING_TASKS.map((task, index) => {
        const Icon = TASK_ICONS[task.id];
        const done = checklist[task.id];
        const current = !done && task.id === activeTaskId;
        const isLast = index === ONBOARDING_TASKS.length - 1;
        const state = done ? "done" : current ? "current" : "todo";

        const dot = (
          <div
            className={`relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
              done
                ? "border-emerald-500 bg-emerald-500 text-white"
                : current
                  ? "border-emerald-500 bg-card text-emerald-600 shadow-[0_0_0_4px_rgba(16,185,129,0.14)] dark:text-emerald-300"
                  : "border-border bg-card text-muted-foreground"
            }`}
            aria-hidden
          >
            {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
          </div>
        );

        return (
          <li
            key={task.id}
            data-task-id={task.id}
            data-task-state={state}
            className="guide-rise relative pb-1 motion-reduce:animate-none"
            style={{ animationDelay: `${index * 55}ms` }}
          >
            {/* Connector rail to the next step. */}
            {!isLast ? (
              <span
                aria-hidden
                className={`absolute left-[18px] top-10 h-[calc(100%-1.75rem)] w-px ${
                  done ? "bg-emerald-500/40" : "bg-border"
                }`}
              />
            ) : null}

            {current ? (
              <div className="relative flex items-start gap-3 rounded-xl bg-emerald-50/70 px-2.5 py-2.5 ring-1 ring-emerald-500/20 dark:bg-emerald-500/10">
                {dot}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13.5px] font-semibold text-foreground">
                      {t(`task_${task.id}_title`)}
                    </p>
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      {t("minutesShort", { min: TASK_MINUTES[task.id] })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t(`task_${task.id}_how`)}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onNavigate(task)}
                    className="mt-2.5 h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold hover:bg-emerald-700"
                  >
                    {t("takeMeThere")}
                    <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : done ? (
              <div className="relative flex items-start gap-3 px-2.5 py-2.5">
                {dot}
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <p className="text-[13.5px] font-semibold text-muted-foreground line-through">
                    {t(`task_${task.id}_title`)}
                  </p>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    {t("completed")}
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(task)}
                aria-label={t(`task_${task.id}_title`)}
                className="group/row relative flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                {dot}
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <p className="text-[13.5px] font-medium text-foreground/80">
                    {t(`task_${task.id}_title`)}
                  </p>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {t("minutesShort", { min: TASK_MINUTES[task.id] })}
                    </span>
                    <ChevronRight
                      className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-foreground"
                      aria-hidden
                    />
                  </span>
                </div>
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
