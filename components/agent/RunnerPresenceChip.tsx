"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useRunnerPresence } from "@/hooks/useRunnerPresence";
import { cn } from "@/lib/utils";

/**
 * One honest line about the Runner: active recently, or offline with the
 * queue waiting. Renders nothing while presence is unknown — a failed poll is
 * not evidence either way, and this chip never guesses.
 */
export function RunnerPresenceChip({
  linkToSetup = false,
  className,
}: {
  /** In the Jobs workspace an offline Runner links to its setup page. */
  linkToSetup?: boolean;
  className?: string;
}) {
  const t = useTranslations("agent.presence");
  const presence = useRunnerPresence(true);

  if (presence.status === "unknown") return null;

  const online = presence.status === "online";
  return (
    <span
      data-testid="runner-presence-chip"
      data-status={presence.status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        online
          ? "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-800 dark:border-brand-emerald-500/30 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300"
          : "border-border bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          online ? "bg-brand-emerald-500" : "bg-muted-foreground/50",
        )}
      />
      {online
        ? presence.minutesAgo === 0
          ? t("activeNow")
          : t("activeAgo", { minutes: presence.minutesAgo })
        : t("offline")}
      {!online && linkToSetup ? (
        <Link
          href="/agent"
          className="font-semibold text-brand-emerald-text underline-offset-2 hover:underline"
        >
          {t("setupCta")}
        </Link>
      ) : null}
    </span>
  );
}
