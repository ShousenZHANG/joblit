"use client";

import Link from "next/link";
import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileQuestion,
  Gauge,
  LoaderCircle,
  MessageSquareQuote,
  Plus,
  RefreshCcw,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  WandSparkles,
} from "lucide-react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAccessibleTabs } from "@/components/ui/useAccessibleTabs";
import { cn } from "@/lib/utils";
import type {
  CareerAnalytics,
  CareerTab,
  InterviewPlan,
  InterviewToolkit,
  JobChoice,
  NegotiationToolkit,
  Offer,
  Reminder,
  ReminderData,
  ReminderSuggestion,
  StarStory,
} from "./types";

const TAB_VALUES = ["overview", "interviews", "stories", "offers"] as const;

type Feedback = {
  kind: "success" | "error";
  message: string;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: string | { message?: string };
  requestId?: string;
};

function apiErrorMessage(payload: ApiEnvelope<unknown> | null, status: number) {
  if (typeof payload?.error === "string") return payload.error;
  if (payload?.error?.message) return payload.error.message;
  return `Request failed (${status})`;
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");

  const response = await fetch(path, {
    ...init,
    headers,
    signal,
  });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok) throw new Error(apiErrorMessage(payload, response.status));
  if (!payload || !("data" in payload)) {
    throw new Error("The server returned an incomplete response.");
  }
  return payload.data as T;
}

async function fetchJobChoices(signal?: AbortSignal): Promise<JobChoice[]> {
  const response = await fetch("/api/jobs?limit=100&sort=newest&market=AU", {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { items?: JobChoice[] };
  return payload.items ?? [];
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function splitLines(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitTags(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalString(form: FormData, key: string) {
  const value = String(form.get(key) ?? "").trim();
  return value || undefined;
}

function optionalNumber(form: FormData, key: string) {
  const value = String(form.get(key) ?? "").trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function optionalIsoDate(form: FormData, key: string) {
  const value = String(form.get(key) ?? "").trim();
  return value ? new Date(value).toISOString() : null;
}

function Surface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border/70 bg-background/90 shadow-[0_18px_38px_-34px_rgba(15,23,42,0.55)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

function NativeSelect({
  className,
  children,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

function DeleteAction({
  label,
  title,
  description,
  busy,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("career");
  return (
    <AlertDialog>
      <AlertDialogPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          disabled={busy}
          aria-label={label}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          {busy ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Trash2 />
          )}
        </Button>
      </AlertDialogPrimitive.Trigger>
      <AlertDialogContent className="max-w-md rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-5 gap-2">
          <AlertDialogCancel className="min-h-11 rounded-lg">
            {t("actions.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="min-h-11 rounded-lg bg-destructive text-white hover:bg-destructive/90"
          >
            {t("actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CareerLoading() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-56 w-full rounded-3xl" />
      <div className="grid gap-4 lg:grid-cols-[1.45fr_0.85fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}

export function CareerClient() {
  const t = useTranslations("career");
  const locale = useLocale();
  const toolkitLocale = locale.startsWith("zh") ? "zh" : "en";
  const [tab, setTab] = useState<CareerTab>("overview");
  const [analytics, setAnalytics] = useState<CareerAnalytics | null>(null);
  const [reminders, setReminders] = useState<ReminderData>({
    persisted: [],
    suggestions: [],
  });
  const [interviews, setInterviews] = useState<InterviewPlan[]>([]);
  const [stories, setStories] = useState<StarStory[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [jobs, setJobs] = useState<JobChoice[]>([]);
  const [interviewToolkit, setInterviewToolkit] =
    useState<InterviewToolkit | null>(null);
  const [negotiationToolkit, setNegotiationToolkit] =
    useState<NegotiationToolkit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busyActionRef = useRef<string | null>(null);

  const tabs = useAccessibleTabs({
    id: "career-workspace",
    value: tab,
    values: TAB_VALUES,
    onValueChange: setTab,
  });

  const loadAll = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setPageError(null);
    try {
      const [
        analyticsData,
        reminderData,
        interviewData,
        storyData,
        offerData,
        jobData,
      ] = await Promise.all([
        apiRequest<CareerAnalytics>("/api/career/analytics", {}, signal),
        apiRequest<ReminderData>("/api/career/reminders", {}, signal),
        apiRequest<InterviewPlan[]>("/api/career/interviews", {}, signal),
        apiRequest<StarStory[]>("/api/career/star-stories", {}, signal),
        apiRequest<Offer[]>("/api/career/offers", {}, signal),
        fetchJobChoices(signal),
      ]);
      if (signal?.aborted) return;
      setAnalytics(analyticsData);
      setReminders(reminderData);
      setInterviews(interviewData);
      setStories(storyData);
      setOffers(offerData);
      setJobs(jobData);
    } catch (error) {
      if (!isAbortError(error)) {
        setPageError(error instanceof Error ? error.message : "Unknown error");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadAll(controller.signal);
    });
    return () => controller.abort();
  }, [loadAll]);

  const refreshAnalytics = useCallback(async () => {
    const next = await apiRequest<CareerAnalytics>("/api/career/analytics");
    setAnalytics(next);
  }, []);

  async function performAction<T>(
    key: string,
    operation: () => Promise<T>,
    commit: (data: T) => void,
    successMessage: string,
  ) {
    if (busyActionRef.current) return false;
    busyActionRef.current = key;
    setBusyAction(key);
    setFeedback(null);
    try {
      const data = await operation();
      commit(data);
      setFeedback({ kind: "success", message: successMessage });
      return true;
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : t("errors.action"),
      });
      return false;
    } finally {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  }

  const saveSuggestion = (suggestion: ReminderSuggestion) =>
    performAction(
      `suggestion:${suggestion.key}`,
      () =>
        apiRequest<Reminder>("/api/career/reminders", {
          method: "POST",
          body: JSON.stringify({
            jobId: suggestion.jobId,
            type: suggestion.type,
            title: t(
              `reminders.suggestionTypes.${suggestion.type}.title`,
            ),
            dueAt: suggestion.dueAt,
          }),
        }),
      (saved) =>
        setReminders((current) => ({
          persisted: [saved, ...current.persisted],
          suggestions: current.suggestions.filter(
            (item) => item.key !== suggestion.key,
          ),
        })),
      t("feedback.reminderSaved"),
    );

  const completeReminder = (reminder: Reminder) =>
    performAction(
      `reminder:${reminder.id}`,
      () =>
        apiRequest<Reminder>("/api/career/reminders", {
          method: "PATCH",
          body: JSON.stringify({ id: reminder.id, completed: true }),
        }),
      (updated) =>
        setReminders((current) => ({
          ...current,
          persisted: current.persisted.map((item) =>
            item.id === updated.id ? updated : item,
          ),
        })),
      t("feedback.reminderCompleted"),
    );

  const createInterview = (payload: Record<string, unknown>) =>
    performAction(
      "interview:create",
      () =>
        apiRequest<InterviewPlan>("/api/career/interviews", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      (created) => setInterviews((current) => [created, ...current]),
      t("feedback.interviewCreated"),
    );

  const completeInterview = (plan: InterviewPlan) =>
    performAction(
      `interview:complete:${plan.id}`,
      () =>
        apiRequest<InterviewPlan>("/api/career/interviews", {
          method: "PATCH",
          body: JSON.stringify({ id: plan.id, status: "COMPLETED" }),
        }),
      (updated) =>
        setInterviews((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        ),
      t("feedback.interviewCompleted"),
    );

  const deleteInterview = (plan: InterviewPlan) =>
    performAction(
      `interview:delete:${plan.id}`,
      () =>
        apiRequest<{ deleted: true }>(
          `/api/career/interviews?id=${encodeURIComponent(plan.id)}`,
          { method: "DELETE" },
        ),
      () =>
        setInterviews((current) =>
          current.filter((item) => item.id !== plan.id),
        ),
      t("feedback.interviewDeleted"),
    );

  const generateInterviewToolkit = (requirements: string[]) =>
    performAction(
      "toolkit:interview",
      () =>
        apiRequest<InterviewToolkit>("/api/career/toolkit", {
          method: "POST",
          body: JSON.stringify({
            action: "interview",
            requirements,
            locale: toolkitLocale,
          }),
        }),
      setInterviewToolkit,
      t("feedback.questionsReady"),
    );

  const createStory = (payload: Record<string, unknown>) =>
    performAction(
      "story:create",
      () =>
        apiRequest<StarStory>("/api/career/star-stories", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      (created) =>
        setStories((current) => [
          created,
          ...current.filter((item) => item.id !== created.id),
        ]),
      t("feedback.storyCreated"),
    );

  const deleteStory = (story: StarStory) =>
    performAction(
      `story:delete:${story.id}`,
      () =>
        apiRequest<{ deleted: true }>(
          `/api/career/star-stories?id=${encodeURIComponent(story.id)}`,
          { method: "DELETE" },
        ),
      () =>
        setStories((current) => current.filter((item) => item.id !== story.id)),
      t("feedback.storyDeleted"),
    );

  const createOffer = (payload: Record<string, unknown>) =>
    performAction(
      "offer:create",
      () =>
        apiRequest<Offer>("/api/career/offers", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      (created) => {
        setOffers((current) => [created, ...current]);
        void refreshAnalytics().catch(() => undefined);
      },
      t("feedback.offerCreated"),
    );

  const deleteOffer = (offer: Offer) =>
    performAction(
      `offer:delete:${offer.id}`,
      () =>
        apiRequest<{ deleted: true }>(
          `/api/career/offers?id=${encodeURIComponent(offer.id)}`,
          { method: "DELETE" },
        ),
      () => {
        setOffers((current) => current.filter((item) => item.id !== offer.id));
        setNegotiationToolkit(null);
        void refreshAnalytics().catch(() => undefined);
      },
      t("feedback.offerDeleted"),
    );

  const generateNegotiation = (offerId: string, strengths: string[]) =>
    performAction(
      "toolkit:negotiation",
      () =>
        apiRequest<NegotiationToolkit>("/api/career/toolkit", {
          method: "POST",
          body: JSON.stringify({
            action: "negotiation",
            offerId,
            strengths,
            locale: toolkitLocale,
          }),
        }),
      setNegotiationToolkit,
      t("feedback.scriptReady"),
    );

  const headlineStats = useMemo(
    () => ({
      activeReminders: reminders.persisted.filter(
        (item) => !item.completedAt && !item.dismissedAt,
      ).length,
      nextInterviews: interviews.filter(
        (item) => item.status !== "COMPLETED" && item.status !== "ARCHIVED",
      ).length,
      activeOffers: offers.filter((item) => item.status === "ACTIVE").length,
    }),
    [interviews, offers, reminders.persisted],
  );

  return (
    <div className="min-h-full space-y-4 pb-8">
      <header className="relative overflow-hidden rounded-3xl border border-brand-emerald-200/70 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_36%),linear-gradient(135deg,var(--background),rgba(236,253,245,0.72))] px-5 py-6 shadow-[0_24px_60px_-48px_rgba(4,120,87,0.9)] dark:bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_38%),linear-gradient(135deg,var(--background),rgba(6,78,59,0.18))] sm:px-7 sm:py-7">
        <div
          className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full border border-brand-emerald-300/30"
          aria-hidden
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-brand-emerald-300/70 bg-brand-emerald-50/80 text-brand-emerald-text"
              >
                <Activity aria-hidden />
                {t("eyebrow")}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t("privacyNote")}
              </span>
            </div>
            <h1 className="text-balance text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-3 max-w-xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
              {t("subtitle")}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[390px]">
            {[
              {
                value: headlineStats.activeReminders,
                label: t("headline.reminders"),
              },
              {
                value: headlineStats.nextInterviews,
                label: t("headline.interviews"),
              },
              {
                value: headlineStats.activeOffers,
                label: t("headline.offers"),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-background/80 bg-background/75 px-3 py-3 shadow-sm backdrop-blur"
              >
                <div className="text-xl font-semibold tabular-nums text-foreground">
                  {item.value}
                </div>
                <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/90 p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div
          {...tabs.tabListProps}
          aria-label={t("tabs.label")}
          className="grid min-w-0 grid-cols-4 gap-1"
        >
          {TAB_VALUES.map((value) => {
            const Icon =
              value === "overview"
                ? Gauge
                : value === "interviews"
                  ? MessageSquareQuote
                  : value === "stories"
                    ? BookOpenCheck
                    : BadgeDollarSign;
            return (
              <button
                key={value}
                type="button"
                {...tabs.getTabProps(value)}
                className={cn(
                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2",
                  tab === value
                    ? "bg-brand-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{t(`tabs.${value}`)}</span>
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="touch"
          onClick={() => void loadAll(undefined, true)}
          disabled={refreshing || loading}
          className="self-end text-muted-foreground sm:self-auto"
        >
          <RefreshCcw
            className={cn(
              refreshing && "animate-spin motion-reduce:animate-none",
            )}
            aria-hidden
          />
          {t(refreshing ? "actions.refreshing" : "actions.refresh")}
        </Button>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {feedback ? (
          <div
            role={feedback.kind === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
              feedback.kind === "success"
                ? "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-text"
                : "border-destructive/30 bg-destructive/5 text-destructive",
            )}
          >
            {feedback.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <span>{feedback.message}</span>
          </div>
        ) : null}
      </div>

      {loading ? (
        <CareerLoading />
      ) : pageError && !analytics ? (
        <Surface className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <CircleAlert aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold">{t("errors.loadTitle")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t("errors.load")}
          </p>
          <p className="mt-2 max-w-md text-xs text-muted-foreground">
            {pageError}
          </p>
          <Button className="mt-5" size="touch" onClick={() => void loadAll()}>
            <RefreshCcw aria-hidden />
            {t("actions.retry")}
          </Button>
        </Surface>
      ) : (
        <>
          <div {...tabs.getPanelProps("overview")}>
            <OverviewPanel
              analytics={analytics}
              reminders={reminders}
              busyAction={busyAction}
              onSaveSuggestion={saveSuggestion}
              onCompleteReminder={completeReminder}
            />
          </div>
          <div {...tabs.getPanelProps("interviews")}>
            <InterviewsPanel
              interviews={interviews}
              jobs={jobs}
              toolkit={interviewToolkit}
              busyAction={busyAction}
              onCreate={createInterview}
              onComplete={completeInterview}
              onDelete={deleteInterview}
              onGenerateToolkit={generateInterviewToolkit}
            />
          </div>
          <div {...tabs.getPanelProps("stories")}>
            <StoriesPanel
              stories={stories}
              busyAction={busyAction}
              onCreate={createStory}
              onDelete={deleteStory}
            />
          </div>
          <div {...tabs.getPanelProps("offers")}>
            <OffersPanel
              analytics={analytics}
              offers={offers}
              negotiation={negotiationToolkit}
              busyAction={busyAction}
              onCreate={createOffer}
              onDelete={deleteOffer}
              onGenerateNegotiation={generateNegotiation}
            />
          </div>
        </>
      )}
    </div>
  );
}

function OverviewPanel({
  analytics,
  reminders,
  busyAction,
  onSaveSuggestion,
  onCompleteReminder,
}: {
  analytics: CareerAnalytics | null;
  reminders: ReminderData;
  busyAction: string | null;
  onSaveSuggestion: (suggestion: ReminderSuggestion) => Promise<boolean>;
  onCompleteReminder: (reminder: Reminder) => Promise<boolean>;
}) {
  const t = useTranslations("career");
  const locale = useLocale();
  const [now] = useState(Date.now);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    [locale],
  );
  const counts = analytics?.funnel.counts ?? {
    applied: 0,
    interview: 0,
    offer: 0,
    accepted: 0,
    rejected: 0,
    withdrawn: 0,
  };
  const stages = [
    { key: "applied", count: counts.applied },
    { key: "interview", count: counts.interview },
    { key: "offer", count: counts.offer },
    { key: "accepted", count: counts.accepted },
  ] as const;
  const transitions = [
    "appliedToInterview",
    "interviewToOffer",
    "offerToAccepted",
  ] as const;
  const openReminders = reminders.persisted.filter(
    (item) => !item.completedAt && !item.dismissedAt,
  );

  const percent = (value: number | null | undefined) =>
    value == null
      ? "—"
      : new Intl.NumberFormat(locale, {
          style: "percent",
          maximumFractionDigits: 0,
        }).format(value);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
      <div className="space-y-4">
        <Surface className="overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border/60 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-brand-emerald-text">
                <Target className="h-4 w-4" aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                  {t("overview.pipelineEyebrow")}
                </span>
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">
                {t("overview.pipelineTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("overview.pipelineSubtitle")}
              </p>
            </div>
            <Badge variant="outline" className="self-start sm:self-auto">
              {t("overview.totalApplied", { count: counts.applied })}
            </Badge>
          </div>

          <div className="p-5">
            <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div
                className="pointer-events-none absolute left-[12%] right-[12%] top-6 hidden h-px bg-gradient-to-r from-brand-emerald-300 via-brand-emerald-500 to-brand-emerald-200 sm:block"
                aria-hidden
              />
              {stages.map((stage, index) => (
                <div
                  key={stage.key}
                  className="relative rounded-2xl border border-border/70 bg-muted/25 p-3 sm:border-0 sm:bg-transparent sm:p-0 sm:text-center"
                >
                  <span
                    className={cn(
                      "relative z-10 inline-flex h-12 min-w-12 items-center justify-center rounded-2xl border-4 border-background px-3 text-lg font-semibold tabular-nums shadow-sm",
                      index === stages.length - 1
                        ? "bg-brand-emerald-600 text-white"
                        : "bg-brand-emerald-50 text-brand-emerald-text",
                    )}
                  >
                    {stage.count}
                  </span>
                  <div className="mt-2 text-sm font-medium">
                    {t(`overview.stages.${stage.key}`)}
                  </div>
                  {index < transitions.length ? (
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground sm:justify-center">
                      <span>
                        {percent(
                          analytics?.funnel.conversion[transitions[index]],
                        )}
                      </span>
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-brand-emerald-text">
                      {t("overview.outcome")}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {counts.applied === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                {t("overview.emptyPipeline")}
              </div>
            ) : null}
          </div>
        </Surface>

        <Surface className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-brand-emerald-text">
                <Gauge className="h-4 w-4" aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                  {t("overview.velocityEyebrow")}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-semibold">
                {t("overview.velocityTitle")}
              </h2>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("overview.median")}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {transitions.map((transition) => {
              const value = analytics?.funnel.medianDays[transition];
              const sample = analytics?.funnel.sampleSizes[transition] ?? 0;
              return (
                <div
                  key={transition}
                  className="rounded-2xl border border-border/60 bg-muted/25 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Clock3
                      className="h-4 w-4 text-brand-emerald-600"
                      aria-hidden
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {t("overview.sample", { count: sample })}
                    </span>
                  </div>
                  <div className="mt-3 text-2xl font-semibold tabular-nums">
                    {value == null
                      ? "—"
                      : t("overview.days", {
                          count: new Intl.NumberFormat(locale, {
                            maximumFractionDigits: 1,
                          }).format(value),
                        })}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t(`overview.transitions.${transition}`)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2.5 py-1">
              {t("overview.rejected", { count: counts.rejected })}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1">
              {t("overview.withdrawn", { count: counts.withdrawn })}
            </span>
          </div>
        </Surface>
      </div>

      <Surface className="h-fit overflow-hidden">
        <div className="border-b border-border/60 px-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-brand-emerald-text">
                <CalendarClock className="h-4 w-4" aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                  {t("reminders.eyebrow")}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-semibold">
                {t("reminders.title")}
              </h2>
            </div>
            <Badge variant="secondary">
              {openReminders.length + reminders.suggestions.length}
            </Badge>
          </div>
        </div>

        <div className="space-y-5 p-4">
          {reminders.suggestions.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {t("reminders.suggested")}
              </div>
              <div className="space-y-2">
                {reminders.suggestions.map((suggestion) => {
                  const actionKey = `suggestion:${suggestion.key}`;
                  const busy = busyAction === actionKey;
                  return (
                    <article
                      key={suggestion.key}
                      className="rounded-xl border border-brand-emerald-200/80 bg-brand-emerald-50/55 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground">
                            {t(
                              `reminders.suggestionTypes.${suggestion.type}.title`,
                            )}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {t(
                              `reminders.suggestionTypes.${suggestion.type}.reason`,
                            )}
                          </p>
                          <div className="mt-2 text-xs font-medium text-brand-emerald-text">
                            {dateFormatter.format(new Date(suggestion.dueAt))}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          disabled={Boolean(busyAction)}
                          onClick={() => void onSaveSuggestion(suggestion)}
                          className="shrink-0"
                        >
                          {busy ? (
                            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                          ) : (
                            <Plus />
                          )}
                          {t("reminders.save")}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("reminders.upNext")}
            </div>
            {openReminders.length > 0 ? (
              <div className="space-y-2">
                {openReminders.slice(0, 8).map((reminder) => {
                  const busy = busyAction === `reminder:${reminder.id}`;
                  const overdue = new Date(reminder.dueAt).getTime() < now;
                  return (
                    <article
                      key={reminder.id}
                      className="group flex items-start gap-3 rounded-xl border border-border/70 p-3 transition-colors hover:border-brand-emerald-200 hover:bg-muted/25"
                    >
                      <button
                        type="button"
                        onClick={() => void onCompleteReminder(reminder)}
                        disabled={Boolean(busyAction)}
                        aria-label={t("reminders.complete", {
                          title: reminder.title,
                        })}
                        className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-brand-emerald-500 hover:bg-brand-emerald-50 hover:text-brand-emerald-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 disabled:opacity-50"
                      >
                        {busy ? (
                          <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium">{reminder.title}</h3>
                        <p
                          className={cn(
                            "mt-1 text-xs",
                            overdue
                              ? "font-medium text-amber-700 dark:text-amber-300"
                              : "text-muted-foreground",
                          )}
                        >
                          {overdue ? `${t("reminders.overdue")} · ` : ""}
                          {dateFormatter.format(new Date(reminder.dueAt))}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center">
                <CheckCircle2
                  className="mx-auto h-6 w-6 text-brand-emerald-600"
                  aria-hidden
                />
                <p className="mt-2 text-sm font-medium">
                  {t("reminders.emptyTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("reminders.empty")}
                </p>
              </div>
            )}
          </div>
        </div>
      </Surface>
    </div>
  );
}

function InterviewsPanel({
  interviews,
  jobs,
  toolkit,
  busyAction,
  onCreate,
  onComplete,
  onDelete,
  onGenerateToolkit,
}: {
  interviews: InterviewPlan[];
  jobs: JobChoice[];
  toolkit: InterviewToolkit | null;
  busyAction: string | null;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onComplete: (plan: InterviewPlan) => Promise<boolean>;
  onDelete: (plan: InterviewPlan) => Promise<boolean>;
  onGenerateToolkit: (requirements: string[]) => Promise<boolean>;
}) {
  const t = useTranslations("career");
  const locale = useLocale();
  const [showCreate, setShowCreate] = useState(false);
  const [showLab, setShowLab] = useState(false);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const jobNames = useMemo(
    () =>
      new Map(
        jobs.map((job) => [
          job.id,
          [job.title, job.company].filter(Boolean).join(" · "),
        ]),
      ),
    [jobs],
  );

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const success = await onCreate({
      jobId: String(form.get("jobId") ?? ""),
      round: Number(form.get("round") ?? 1),
      title: String(form.get("title") ?? "").trim(),
      scheduledAt: optionalIsoDate(form, "scheduledAt"),
      requirements: splitLines(form.get("requirements")),
      locale: locale.startsWith("zh") ? "zh" : "en",
      notes: optionalString(form, "notes"),
    });
    if (success) {
      formElement.reset();
      setShowCreate(false);
    }
  };

  const handleToolkit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requirements = splitLines(
      new FormData(event.currentTarget).get("requirements"),
    );
    if (requirements.length > 0) await onGenerateToolkit(requirements);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-brand-emerald-text">
            <MessageSquareQuote className="h-4 w-4" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">
              {t("interviews.eyebrow")}
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {t("interviews.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("interviews.subtitle")}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={() => setShowLab((value) => !value)}
          >
            <WandSparkles aria-hidden />
            {t("interviews.questionLab")}
          </Button>
          <Button
            type="button"
            size="touch"
            onClick={() => setShowCreate((value) => !value)}
            disabled={jobs.length === 0}
          >
            <Plus aria-hidden />
            {t("interviews.newPlan")}
          </Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("interviews.noJobs")}</span>
          <Button variant="outline" size="sm" asChild>
            <Link href="/jobs">{t("interviews.openJobs")}</Link>
          </Button>
        </div>
      ) : null}

      {showCreate ? (
        <Surface className="p-5">
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">{t("interviews.form.title")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("interviews.form.hint")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCreate(false)}
              >
                {t("actions.close")}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_110px]">
              <div className="space-y-2">
                <Label htmlFor="career-interview-job">
                  {t("interviews.form.job")}
                </Label>
                <NativeSelect
                  id="career-interview-job"
                  name="jobId"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    {t("interviews.form.chooseJob")}
                  </option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {[job.title, job.company].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="career-interview-round">
                  {t("interviews.form.round")}
                </Label>
                <Input
                  id="career-interview-round"
                  name="round"
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={1}
                  required
                  className="h-11"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="career-interview-title">
                  {t("interviews.form.planTitle")}
                </Label>
                <Input
                  id="career-interview-title"
                  name="title"
                  required
                  maxLength={200}
                  placeholder={t("interviews.form.titlePlaceholder")}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="career-interview-date">
                  {t("interviews.form.scheduled")}
                </Label>
                <Input
                  id="career-interview-date"
                  name="scheduledAt"
                  type="datetime-local"
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="career-interview-requirements">
                {t("interviews.form.requirements")}
              </Label>
              <Textarea
                id="career-interview-requirements"
                name="requirements"
                required
                rows={5}
                placeholder={t("interviews.form.requirementsPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("interviews.form.requirementsHint")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="career-interview-notes">
                {t("interviews.form.notes")}
              </Label>
              <Textarea
                id="career-interview-notes"
                name="notes"
                rows={3}
                maxLength={10_000}
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="touch"
                disabled={Boolean(busyAction)}
              >
                {busyAction === "interview:create" ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Sparkles />
                )}
                {t("interviews.form.save")}
              </Button>
            </div>
          </form>
        </Surface>
      ) : null}

      {showLab ? (
        <Surface className="overflow-hidden">
          <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
            <form
              onSubmit={handleToolkit}
              className="border-b border-border/60 p-5 lg:border-b-0 lg:border-r"
            >
              <div className="flex items-center gap-2">
                <FileQuestion
                  className="h-4 w-4 text-brand-emerald-600"
                  aria-hidden
                />
                <h3 className="font-semibold">{t("interviews.lab.title")}</h3>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("interviews.lab.subtitle")}
              </p>
              <Label
                htmlFor="career-question-requirements"
                className="mt-4"
              >
                {t("interviews.form.requirements")}
              </Label>
              <Textarea
                id="career-question-requirements"
                name="requirements"
                required
                rows={6}
                className="mt-2"
                placeholder={t("interviews.form.requirementsPlaceholder")}
              />
              <Button
                type="submit"
                size="touch"
                className="mt-4 w-full"
                disabled={Boolean(busyAction)}
              >
                {busyAction === "toolkit:interview" ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <WandSparkles />
                )}
                {t("interviews.lab.generate")}
              </Button>
            </form>
            <div className="p-5">
              {toolkit?.questions.length ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">
                      {t("interviews.lab.output")}
                    </h3>
                    <Badge variant="secondary">
                      {t("interviews.lab.storyCount", {
                        count: toolkit.grounding.storyCount,
                      })}
                    </Badge>
                  </div>
                  {toolkit.questions.map((question, index) => (
                    <details
                      key={question.id}
                      className="group rounded-xl border border-border/70 bg-muted/20 p-3"
                      open={index === 0}
                    >
                      <summary className="cursor-pointer list-none pr-6 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600">
                        <span className="mr-2 text-brand-emerald-text">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {question.question}
                      </summary>
                      <div className="mt-3 border-t border-border/60 pt-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("interviews.lab.followUps")}
                        </p>
                        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
                          {question.followUps.map((item) => (
                            <li key={item} className="flex gap-2">
                              <ChevronRight className="mt-1 h-3 w-3 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center text-center">
                  <FileQuestion
                    className="h-7 w-7 text-muted-foreground"
                    aria-hidden
                  />
                  <p className="mt-3 text-sm font-medium">
                    {t("interviews.lab.emptyTitle")}
                  </p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                    {t("interviews.lab.empty")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Surface>
      ) : null}

      {interviews.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {interviews.map((plan) => {
            const questions = Array.isArray(plan.questions)
              ? plan.questions
              : [];
            const busyComplete =
              busyAction === `interview:complete:${plan.id}`;
            const busyDelete = busyAction === `interview:delete:${plan.id}`;
            return (
              <Surface key={plan.id} className="overflow-hidden">
                <div className="border-b border-border/60 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            plan.status === "COMPLETED"
                              ? "secondary"
                              : "outline"
                          }
                          className={
                            plan.status !== "COMPLETED"
                              ? "border-brand-emerald-200 text-brand-emerald-text"
                              : undefined
                          }
                        >
                          {t(`interviews.status.${plan.status.toLowerCase()}`)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {t("interviews.round", { count: plan.round })}
                        </span>
                      </div>
                      <h3 className="mt-2 truncate text-lg font-semibold">
                        {plan.title}
                      </h3>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {jobNames.get(plan.jobId) ??
                          t("interviews.unknownJob")}
                      </p>
                    </div>
                    <DeleteAction
                      label={t("interviews.deleteLabel", {
                        title: plan.title,
                      })}
                      title={t("interviews.deleteTitle")}
                      description={t("interviews.deleteDescription", {
                        title: plan.title,
                      })}
                      busy={busyDelete}
                      onConfirm={() => void onDelete(plan)}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {plan.scheduledAt
                        ? dateFormatter.format(new Date(plan.scheduledAt))
                        : t("interviews.unscheduled")}
                    </span>
                    <span>{t("interviews.questionCount", { count: questions.length })}</span>
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  {questions.slice(0, 4).map((question, index) => (
                    <details
                      key={question.id}
                      className="rounded-xl border border-border/60 px-3 py-2.5"
                    >
                      <summary className="cursor-pointer list-none text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600">
                        <span className="mr-2 text-xs text-brand-emerald-text">
                          {index + 1}.
                        </span>
                        {question.question}
                      </summary>
                      <ul className="mt-3 space-y-1 border-t border-border/50 pt-3 text-xs leading-5 text-muted-foreground">
                        {question.followUps.map((followUp) => (
                          <li key={followUp}>• {followUp}</li>
                        ))}
                      </ul>
                    </details>
                  ))}
                  {questions.length === 0 ? (
                    <p className="rounded-xl bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                      {t("interviews.noQuestions")}
                    </p>
                  ) : null}
                  {plan.status !== "COMPLETED" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="touch"
                      className="mt-2 w-full"
                      disabled={Boolean(busyAction)}
                      onClick={() => void onComplete(plan)}
                    >
                      {busyComplete ? (
                        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <CheckCircle2 />
                      )}
                      {t("interviews.markComplete")}
                    </Button>
                  ) : null}
                </div>
              </Surface>
            );
          })}
        </div>
      ) : (
        <Surface className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-emerald-50 text-brand-emerald-text">
            <MessageSquareQuote aria-hidden />
          </span>
          <h3 className="mt-4 font-semibold">{t("interviews.emptyTitle")}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t("interviews.empty")}
          </p>
        </Surface>
      )}
    </div>
  );
}

function StoriesPanel({
  stories,
  busyAction,
  onCreate,
  onDelete,
}: {
  stories: StarStory[];
  busyAction: string | null;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onDelete: (story: StarStory) => Promise<boolean>;
}) {
  const t = useTranslations("career");
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const success = await onCreate({
      title: String(form.get("title") ?? "").trim(),
      situation: String(form.get("situation") ?? "").trim(),
      task: String(form.get("task") ?? "").trim(),
      action: String(form.get("action") ?? "").trim(),
      result: String(form.get("result") ?? "").trim(),
      reflection: optionalString(form, "reflection"),
      skills: splitTags(form.get("skills")),
      tags: splitTags(form.get("tags")),
    });
    if (success) {
      formElement.reset();
      setShowCreate(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-brand-emerald-text">
            <BookOpenCheck className="h-4 w-4" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">
              {t("stories.eyebrow")}
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {t("stories.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("stories.subtitle")}
          </p>
        </div>
        <Button
          type="button"
          size="touch"
          onClick={() => setShowCreate((value) => !value)}
        >
          <Plus aria-hidden />
          {t("stories.new")}
        </Button>
      </div>

      {showCreate ? (
        <Surface className="p-5">
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">{t("stories.form.title")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("stories.form.hint")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCreate(false)}
              >
                {t("actions.close")}
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="career-story-title">
                {t("stories.form.storyTitle")}
              </Label>
              <Input
                id="career-story-title"
                name="title"
                required
                maxLength={200}
                className="h-11"
                placeholder={t("stories.form.titlePlaceholder")}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {(["situation", "task", "action", "result"] as const).map(
                (field) => (
                  <div key={field} className="space-y-2">
                    <Label htmlFor={`career-story-${field}`}>
                      {t(`stories.form.${field}`)}
                    </Label>
                    <Textarea
                      id={`career-story-${field}`}
                      name={field}
                      required
                      rows={field === "action" ? 5 : 4}
                      placeholder={t(`stories.form.${field}Placeholder`)}
                    />
                  </div>
                ),
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="career-story-reflection">
                {t("stories.form.reflection")}
              </Label>
              <Textarea
                id="career-story-reflection"
                name="reflection"
                rows={3}
                placeholder={t("stories.form.reflectionPlaceholder")}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="career-story-skills">
                  {t("stories.form.skills")}
                </Label>
                <Input
                  id="career-story-skills"
                  name="skills"
                  className="h-11"
                  placeholder={t("stories.form.skillsPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="career-story-tags">
                  {t("stories.form.tags")}
                </Label>
                <Input
                  id="career-story-tags"
                  name="tags"
                  className="h-11"
                  placeholder={t("stories.form.tagsPlaceholder")}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="touch"
                disabled={Boolean(busyAction)}
              >
                {busyAction === "story:create" ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <BookOpenCheck />
                )}
                {t("stories.form.save")}
              </Button>
            </div>
          </form>
        </Surface>
      ) : null}

      {stories.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {stories.map((story) => (
            <Surface key={story.id} className="overflow-hidden">
              <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-1.5">
                    {story.skills.slice(0, 4).map((skill) => (
                      <Badge
                        key={skill}
                        variant="outline"
                        className="border-brand-emerald-200 text-brand-emerald-text"
                      >
                        {skill}
                      </Badge>
                    ))}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold">{story.title}</h3>
                  {story.tags.length ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {story.tags.map((tag) => `#${tag}`).join(" · ")}
                    </p>
                  ) : null}
                </div>
                <DeleteAction
                  label={t("stories.deleteLabel", { title: story.title })}
                  title={t("stories.deleteTitle")}
                  description={t("stories.deleteDescription", {
                    title: story.title,
                  })}
                  busy={busyAction === `story:delete:${story.id}`}
                  onConfirm={() => void onDelete(story)}
                />
              </div>
              <div className="space-y-2 p-4">
                {(["situation", "task", "action", "result"] as const).map(
                  (field) => (
                    <details
                      key={field}
                      className="rounded-xl border border-border/60 px-3 py-2.5"
                      open={field === "result"}
                    >
                      <summary className="cursor-pointer list-none text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600">
                        <span className="mr-2 text-brand-emerald-text">
                          {field.slice(0, 1).toUpperCase()}
                        </span>
                        {t(`stories.form.${field}`)}
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap border-t border-border/50 pt-2 text-sm leading-6 text-muted-foreground">
                        {story[field]}
                      </p>
                    </details>
                  ),
                )}
                {story.reflection ? (
                  <div className="rounded-xl bg-brand-emerald-50/60 px-3 py-3">
                    <div className="text-xs font-semibold text-brand-emerald-text">
                      {t("stories.form.reflection")}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {story.reflection}
                    </p>
                  </div>
                ) : null}
              </div>
            </Surface>
          ))}
        </div>
      ) : (
        <Surface className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-emerald-50 text-brand-emerald-text">
            <BookOpenCheck aria-hidden />
          </span>
          <h3 className="mt-4 font-semibold">{t("stories.emptyTitle")}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t("stories.empty")}
          </p>
        </Surface>
      )}
    </div>
  );
}

function OffersPanel({
  analytics,
  offers,
  negotiation,
  busyAction,
  onCreate,
  onDelete,
  onGenerateNegotiation,
}: {
  analytics: CareerAnalytics | null;
  offers: Offer[];
  negotiation: NegotiationToolkit | null;
  busyAction: string | null;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onDelete: (offer: Offer) => Promise<boolean>;
  onGenerateNegotiation: (
    offerId: string,
    strengths: string[],
  ) => Promise<boolean>;
}) {
  const t = useTranslations("career");
  const locale = useLocale();
  const [showCreate, setShowCreate] = useState(false);

  const formatMoney = (value: number, currency: string) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return `${currency} ${new Intl.NumberFormat(locale).format(value)}`;
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const success = await onCreate({
      company: String(form.get("company") ?? "").trim(),
      role: String(form.get("role") ?? "").trim(),
      currency: String(form.get("currency") ?? "AUD"),
      baseSalaryAnnual: optionalNumber(form, "baseSalaryAnnual"),
      bonusAnnual: optionalNumber(form, "bonusAnnual"),
      equityAnnual: optionalNumber(form, "equityAnnual"),
      otherAnnual: optionalNumber(form, "otherAnnual"),
      targetSalaryAnnual: optionalNumber(form, "targetSalaryAnnual"),
      benefits: splitLines(form.get("benefits")),
      location: optionalString(form, "location"),
      status: "ACTIVE",
      deadlineAt: optionalIsoDate(form, "deadlineAt"),
      notes: optionalString(form, "notes"),
    });
    if (success) {
      formElement.reset();
      setShowCreate(false);
    }
  };

  const handleNegotiation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onGenerateNegotiation(
      String(form.get("offerId") ?? ""),
      splitLines(form.get("strengths")),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-brand-emerald-text">
            <BadgeDollarSign className="h-4 w-4" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">
              {t("offers.eyebrow")}
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {t("offers.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("offers.subtitle")}
          </p>
        </div>
        <Button
          type="button"
          size="touch"
          onClick={() => setShowCreate((value) => !value)}
        >
          <Plus aria-hidden />
          {t("offers.new")}
        </Button>
      </div>

      {showCreate ? (
        <Surface className="p-5">
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">{t("offers.form.title")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("offers.form.hint")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCreate(false)}
              >
                {t("actions.close")}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="career-offer-company">
                  {t("offers.form.company")}
                </Label>
                <Input
                  id="career-offer-company"
                  name="company"
                  required
                  maxLength={200}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="career-offer-role">
                  {t("offers.form.role")}
                </Label>
                <Input
                  id="career-offer-role"
                  name="role"
                  required
                  maxLength={200}
                  className="h-11"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="career-offer-currency">
                  {t("offers.form.currency")}
                </Label>
                <NativeSelect
                  id="career-offer-currency"
                  name="currency"
                  defaultValue="AUD"
                >
                  {["AUD", "USD", "NZD", "GBP", "EUR", "CAD", "CNY"].map(
                    (currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ),
                  )}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="career-offer-location">
                  {t("offers.form.location")}
                </Label>
                <Input
                  id="career-offer-location"
                  name="location"
                  maxLength={200}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="career-offer-deadline">
                  {t("offers.form.deadline")}
                </Label>
                <Input
                  id="career-offer-deadline"
                  name="deadlineAt"
                  type="datetime-local"
                  className="h-11"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                "baseSalaryAnnual",
                "bonusAnnual",
                "equityAnnual",
                "otherAnnual",
                "targetSalaryAnnual",
              ].map((field) => (
                <div key={field} className="space-y-2">
                  <Label htmlFor={`career-offer-${field}`}>
                    {t(`offers.form.${field}`)}
                  </Label>
                  <Input
                    id={`career-offer-${field}`}
                    name={field}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="h-11"
                  />
                </div>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="career-offer-benefits">
                  {t("offers.form.benefits")}
                </Label>
                <Textarea
                  id="career-offer-benefits"
                  name="benefits"
                  rows={4}
                  placeholder={t("offers.form.benefitsPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="career-offer-notes">
                  {t("offers.form.notes")}
                </Label>
                <Textarea
                  id="career-offer-notes"
                  name="notes"
                  rows={4}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="touch"
                disabled={Boolean(busyAction)}
              >
                {busyAction === "offer:create" ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <BadgeDollarSign />
                )}
                {t("offers.form.save")}
              </Button>
            </div>
          </form>
        </Surface>
      ) : null}

      {analytics?.offers.currencies.length ? (
        <Surface className="overflow-hidden">
          <div className="border-b border-border/60 p-5">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-brand-emerald-600" aria-hidden />
              <h3 className="font-semibold">{t("offers.compare.title")}</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("offers.compare.note")}
            </p>
          </div>
          <div className="space-y-5 p-4">
            {analytics.offers.currencies.map((group) => (
              <div key={group.currency}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {group.currency}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("offers.compare.count", {
                      count: group.offers.length,
                    })}
                  </span>
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  {group.offers.map((offer) => (
                    <article
                      key={offer.id}
                      className={cn(
                        "rounded-xl border p-4",
                        offer.rank === 1
                          ? "border-brand-emerald-300 bg-brand-emerald-50/55"
                          : "border-border/70 bg-muted/20",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">
                            {offer.company}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {offer.role}
                          </div>
                        </div>
                        <Badge
                          variant={offer.rank === 1 ? "default" : "secondary"}
                        >
                          #{offer.rank}
                        </Badge>
                      </div>
                      <div className="mt-4 text-xl font-semibold tabular-nums">
                        {formatMoney(offer.totalAnnual, offer.currency)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{t("offers.compare.total")}</span>
                        {offer.incomplete ? (
                          <span className="text-amber-700 dark:text-amber-300">
                            {t("offers.compare.incomplete")}
                          </span>
                        ) : null}
                      </div>
                      {offer.salaryGap != null ? (
                        <div
                          className={cn(
                            "mt-3 rounded-lg px-2.5 py-2 text-xs font-medium",
                            offer.salaryGap > 0
                              ? "bg-amber-100/70 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                              : "bg-brand-emerald-100/70 text-brand-emerald-text",
                          )}
                        >
                          {offer.salaryGap > 0
                            ? t("offers.compare.belowTarget", {
                                amount: formatMoney(
                                  offer.salaryGap,
                                  offer.currency,
                                ),
                              })
                            : t("offers.compare.atTarget")}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      {offers.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <Surface className="h-fit overflow-hidden">
            <div className="border-b border-border/60 p-5">
              <h3 className="font-semibold">{t("offers.savedTitle")}</h3>
            </div>
            <div className="divide-y divide-border/60">
              {offers.map((offer) => {
                const total = [
                  offer.baseSalaryAnnual,
                  offer.bonusAnnual,
                  offer.equityAnnual,
                  offer.otherAnnual,
                ]
                  .filter((value): value is number => value != null)
                  .reduce((sum, value) => sum + value, 0);
                return (
                  <article
                    key={offer.id}
                    className="flex items-start justify-between gap-3 p-4"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-semibold">
                          {offer.company}
                        </h4>
                        <Badge variant="outline">
                          {t(`offers.status.${offer.status.toLowerCase()}`)}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {offer.role}
                        {offer.location ? ` · ${offer.location}` : ""}
                      </p>
                      <p className="mt-2 text-sm font-semibold tabular-nums text-brand-emerald-text">
                        {formatMoney(total, offer.currency)}
                      </p>
                    </div>
                    <DeleteAction
                      label={t("offers.deleteLabel", {
                        company: offer.company,
                      })}
                      title={t("offers.deleteTitle")}
                      description={t("offers.deleteDescription", {
                        company: offer.company,
                      })}
                      busy={busyAction === `offer:delete:${offer.id}`}
                      onConfirm={() => void onDelete(offer)}
                    />
                  </article>
                );
              })}
            </div>
          </Surface>

          <Surface className="overflow-hidden">
            <div className="border-b border-border/60 p-5">
              <div className="flex items-center gap-2">
                <WandSparkles
                  className="h-4 w-4 text-brand-emerald-600"
                  aria-hidden
                />
                <h3 className="font-semibold">{t("offers.negotiate.title")}</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("offers.negotiate.subtitle")}
              </p>
            </div>
            <div className="grid lg:grid-cols-[0.78fr_1.22fr]">
              <form
                onSubmit={handleNegotiation}
                className="border-b border-border/60 p-5 lg:border-b-0 lg:border-r"
              >
                <div className="space-y-2">
                  <Label htmlFor="career-negotiation-offer">
                    {t("offers.negotiate.offer")}
                  </Label>
                  <NativeSelect
                    id="career-negotiation-offer"
                    name="offerId"
                    required
                    defaultValue={offers[0]?.id}
                  >
                    {offers.map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        {offer.company} · {offer.role}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="career-negotiation-strengths">
                    {t("offers.negotiate.strengths")}
                  </Label>
                  <Textarea
                    id="career-negotiation-strengths"
                    name="strengths"
                    rows={7}
                    placeholder={t("offers.negotiate.strengthsPlaceholder")}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("offers.negotiate.grounded")}
                  </p>
                </div>
                <Button
                  type="submit"
                  size="touch"
                  className="mt-4 w-full"
                  disabled={Boolean(busyAction)}
                >
                  {busyAction === "toolkit:negotiation" ? (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <WandSparkles />
                  )}
                  {t("offers.negotiate.generate")}
                </Button>
              </form>
              <div className="p-5">
                {negotiation?.script ? (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold">
                        {t("offers.negotiate.script")}
                      </h4>
                      <Badge
                        variant="outline"
                        className="border-brand-emerald-200 text-brand-emerald-text"
                      >
                        {t("offers.negotiate.noInventedFacts")}
                      </Badge>
                    </div>
                    <div className="mt-3 whitespace-pre-wrap rounded-xl border border-brand-emerald-200/70 bg-brand-emerald-50/45 p-4 text-sm leading-7 text-foreground">
                      {negotiation.script}
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-64 flex-col items-center justify-center text-center">
                    <BadgeDollarSign
                      className="h-8 w-8 text-muted-foreground"
                      aria-hidden
                    />
                    <p className="mt-3 text-sm font-medium">
                      {t("offers.negotiate.emptyTitle")}
                    </p>
                    <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                      {t("offers.negotiate.empty")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Surface>
        </div>
      ) : (
        <Surface className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-emerald-50 text-brand-emerald-text">
            <BriefcaseBusiness aria-hidden />
          </span>
          <h3 className="mt-4 font-semibold">{t("offers.emptyTitle")}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t("offers.empty")}
          </p>
        </Surface>
      )}
    </div>
  );
}
