"use client";

import { AlertTriangle, Check, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AiApplicationReview } from "@/lib/shared/schemas/aiContent";
import { cn } from "@/lib/utils";

export function ReviewGateCard({
  review,
}: {
  review: AiApplicationReview | undefined;
}) {
  const t = useTranslations("tailor.review");
  if (!review) return null;

  const tone =
    review.verdict === "pass"
      ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-950 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100"
      : review.verdict === "blocked"
        ? "border-rose-200/80 bg-rose-50/70 text-rose-950 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100"
        : "border-amber-200/80 bg-amber-50/70 text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100";
  const Icon = review.verdict === "pass" ? ShieldCheck : AlertTriangle;

  return (
    <section
      aria-labelledby="application-review-heading"
      className={cn("rounded-2xl border px-4 py-3 shadow-sm", tone)}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/80 ring-1 ring-current/10">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="application-review-heading" className="text-sm font-semibold">
                {t("title")}
              </h2>
              <p className="mt-0.5 text-xs opacity-75">
                {t("coverage", { percent: review.coveragePercent })}
              </p>
            </div>
            <span className="rounded-full bg-background/75 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ring-current/10">
              {t(`verdict.${review.verdict}`)}
            </span>
          </div>

          {review.issues.length > 0 ? (
            <ul className="mt-3 space-y-1.5 text-xs">
              {review.issues.slice(0, 4).map((issue) => (
                <li key={issue} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-xs">
              <Check className="h-3.5 w-3.5" aria-hidden />
              {t("clear")}
            </p>
          )}

          <p className="mt-3 border-t border-current/10 pt-2 text-[11px] opacity-70">
            {t("finalizeHint")}
          </p>
        </div>
      </div>
    </section>
  );
}
