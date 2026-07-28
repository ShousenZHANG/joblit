"use client";

import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_MIN_HEIGHT } from "@/components/ui/touchTarget";
import { cn } from "@/lib/utils";
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

type TaskVariantProps = {
  task: OnboardingTask;
  dot: React.ReactNode;
  onNavigate: (task: OnboardingTask) => void;
};

function TaskDot({
  task,
  done,
  current,
}: {
  task: OnboardingTask;
  done: boolean;
  current: boolean;
}) {
  const Icon = TASK_ICONS[task.id];
  return (
    <div
      className={cn(
        "relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors motion-reduce:transition-none",
        done && "border-emerald-500 bg-emerald-500 text-white",
        current &&
          "border-emerald-500 bg-card text-emerald-600 shadow-[0_0_0_4px_rgba(16,185,129,0.14)] dark:text-emerald-300",
        !done && !current && "border-border bg-card text-muted-foreground",
      )}
      aria-hidden
    >
      {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
    </div>
  );
}

function CurrentTask({ task, dot, onNavigate }: TaskVariantProps) {
  const t = useTranslations("guide");
  return (
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
          className={cn(
            "mt-2.5 h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold hover:bg-emerald-700",
            COARSE_POINTER_MIN_HEIGHT,
          )}
        >
          {t("takeMeThere")}
          <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function CompletedTask({ task, dot }: Omit<TaskVariantProps, "onNavigate">) {
  const t = useTranslations("guide");
  return (
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
  );
}

function UpcomingTask({ task, dot, onNavigate }: TaskVariantProps) {
  const t = useTranslations("guide");
  return (
    <button
      type="button"
      onClick={() => onNavigate(task)}
      aria-label={t(`task_${task.id}_title`)}
      className={cn(
        "group/row relative flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none",
        COARSE_POINTER_MIN_HEIGHT,
      )}
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
            className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-foreground motion-reduce:transition-none"
            aria-hidden
          />
        </span>
      </div>
    </button>
  );
}

function GuideTaskRow({
  task,
  index,
  checklist,
  activeTaskId,
  onNavigate,
}: GuideTaskListProps & { task: OnboardingTask; index: number }) {
  const done = checklist[task.id];
  const current = !done && task.id === activeTaskId;
  const state = done ? "done" : current ? "current" : "todo";
  const dot = <TaskDot task={task} done={done} current={current} />;
  return (
    <li
      data-task-id={task.id}
      data-task-state={state}
      className="guide-rise relative pb-1 motion-reduce:animate-none"
      style={{ animationDelay: `${index * 55}ms` }}
    >
      {index < ONBOARDING_TASKS.length - 1 ? (
        <span
          aria-hidden
          className={cn(
            "absolute left-[18px] top-10 h-[calc(100%-1.75rem)] w-px",
            done ? "bg-emerald-500/40" : "bg-border",
          )}
        />
      ) : null}
      {current ? <CurrentTask task={task} dot={dot} onNavigate={onNavigate} /> : null}
      {done ? <CompletedTask task={task} dot={dot} /> : null}
      {!current && !done ? <UpcomingTask task={task} dot={dot} onNavigate={onNavigate} /> : null}
    </li>
  );
}

export function GuideTaskList(props: GuideTaskListProps) {
  return (
    <ol
      className="flex-1 overflow-y-auto px-5 py-4"
      data-testid="guide-quickstart-list"
    >
      {ONBOARDING_TASKS.map((task, index) => (
        <GuideTaskRow
          key={task.id}
          task={task}
          index={index}
          {...props}
        />
      ))}
    </ol>
  );
}
