"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, Copy, Loader2, Plug, RefreshCw, X } from "lucide-react";

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
import { Popover, PopoverContent } from "@/components/ui/popover";
import { COARSE_POINTER_TARGET } from "@/components/ui/touchTarget";
import { useAgentTokens } from "@/hooks/useAgentTokens";
import {
  beginRunnerConnectionCheck,
  cancelRunnerConnectionCheck,
  refreshRunnerPresenceForCredential,
  useRunnerPresence,
} from "@/hooks/useRunnerPresence";
import { cn } from "@/lib/utils";

type Shell = "powershell" | "bash";

function startCommand(origin: string, token: string, shell: Shell) {
  if (shell === "powershell") {
    return `$env:JOBLIT_URL='${origin}'; $env:JOBLIT_TOKEN='${token}'; node tools/runner/cli.mjs --watch`;
  }
  return `JOBLIT_URL='${origin}' JOBLIT_TOKEN='${token}' node tools/runner/cli.mjs --watch`;
}

function CopyRow({
  label,
  value,
  onCopied,
}: {
  label: string;
  value: string;
  onCopied?: () => void;
}) {
  const t = useTranslations("runnerSetup");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      onCopied?.();
    } catch {
      setCopyState("failed");
    }
  }, [onCopied, value]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [copyState]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
        >
          {copyState === "copied" ? (
            <Check className="h-3.5 w-3.5 text-brand-emerald-600" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          {copyState === "copied" ? t("copied") : t("copy")}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-muted/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/85">
        {value}
      </pre>
      <span className="sr-only" aria-live="polite">
        {copyState === "copied"
          ? t("copied")
          : copyState === "failed"
            ? t("copyFailed")
            : ""}
      </span>
    </div>
  );
}

export function RunnerSetupPopover({ className }: { className?: string }) {
  const t = useTranslations("runnerSetup");
  const [open, setOpen] = useState(false);
  const [shell, setShell] = useState<Shell>("powershell");
  const [awaitingRunner, setAwaitingRunner] = useState(false);
  const awaitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    tokens,
    loading,
    loadError,
    newToken,
    creating,
    refresh: refreshTokens,
    create,
    replace,
  } = useAgentTokens();
  const newCredentialId = newToken?.id ?? null;
  // The trigger is a global status indicator, so it remains subscribed while
  // the app shell is mounted. The shared presence store deduplicates this with
  // Jobs and any open setup panel.
  const presence = useRunnerPresence(true);
  const refreshPresence = presence.refresh;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) void refreshPresence();
    },
    [refreshPresence],
  );

  useEffect(() => {
    const openPanel = () => handleOpenChange(true);
    window.addEventListener("joblit:runner-setup", openPanel);
    return () => window.removeEventListener("joblit:runner-setup", openPanel);
  }, [handleOpenChange]);

  useEffect(() => {
    return () => {
      cancelRunnerConnectionCheck();
      if (awaitingTimerRef.current !== null) {
        clearTimeout(awaitingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!newCredentialId) return;
    // Bind as soon as the one-time command becomes visible. The previous
    // Runner may remain online while its DELETE is settling, but its activity
    // must never make the replacement command look connected.
    void refreshRunnerPresenceForCredential(newCredentialId);
  }, [newCredentialId]);

  const hasCredential = tokens.length > 0;
  const online =
    presence.status === "online" &&
    (!newCredentialId || presence.credentialId === newCredentialId);
  const checkDelayed = online && presence.checkDelayed;

  const handleCommandCopied = useCallback(() => {
    if (!newCredentialId) return;
    if (awaitingTimerRef.current !== null) {
      clearTimeout(awaitingTimerRef.current);
    }
    setAwaitingRunner(true);
    awaitingTimerRef.current = setTimeout(() => {
      awaitingTimerRef.current = null;
      setAwaitingRunner(false);
    }, 15_000);
    void beginRunnerConnectionCheck(newCredentialId);
  }, [newCredentialId]);

  const handleReplace = useCallback(async () => {
    const issued = await replace(tokens, "Joblit Runner");
    if (issued) {
      // The old credential revocations have now settled. Force a fresh scoped
      // read rather than waiting for the ordinary five-second poll.
      await refreshRunnerPresenceForCredential(issued.id);
    }
  }, [replace, tokens]);

  const statusText = useMemo(() => {
    if (presence.status === "unknown") return t("statusChecking");
    if (presence.status === "unavailable") return t("statusUnavailable");
    if (presence.status === "online" && online) {
      if (presence.checkDelayed) return t("statusCheckDelayed");
      return t("statusOnlineRecent", { seconds: presence.secondsAgo });
    }
    if (awaitingRunner) return t("statusWaiting");
    if (hasCredential) return t("statusCredentialReady");
    if (!presence.lastUsedAt) return t("statusOfflineNever");
    const minutes = Math.max(1, presence.minutesAgo ?? 0);
    return t("statusOfflineLastSeen", { minutes });
  }, [awaitingRunner, hasCredential, online, presence, t]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const command = newToken?.rawToken
    ? startCommand(origin, newToken.rawToken, shell)
    : null;

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={t("open")}
            title={t("open")}
            data-testid="runner-setup-trigger"
            className={cn(
              "relative inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 md:h-9 md:w-9",
              COARSE_POINTER_TARGET,
              className,
            )}
          >
            <Plug className="h-4 w-4" aria-hidden />
            {online ? (
              <span
                aria-hidden
                data-testid="runner-online-dot"
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background"
              />
            ) : null}
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverContent
          align="end"
          sideOffset={10}
          aria-labelledby="runner-setup-title"
          data-testid="runner-setup-panel"
          className="max-h-[calc(100dvh-2rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl p-0"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/60 py-3 pl-4 pr-2">
            <div>
              <h2
                id="runner-setup-title"
                className="text-[13px] font-bold tracking-tight text-foreground"
              >
                {t("title")}
              </h2>
              <p
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-testid="runner-setup-status"
                className={cn(
                  "mt-0.5 flex items-center gap-1.5 text-[11px]",
                  checkDelayed
                    ? "text-amber-700 dark:text-amber-300"
                    : online
                      ? "text-brand-emerald-text"
                      : "text-muted-foreground",
                )}
              >
                {awaitingRunner && !online ? (
                  <Loader2
                    className="h-3 w-3 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      checkDelayed || presence.status === "unavailable"
                        ? "bg-amber-500"
                        : online
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/40",
                    )}
                  />
                )}
                {statusText}
              </p>
            </div>
            <PopoverPrimitive.Close asChild>
              <button
                type="button"
                aria-label={t("close")}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </PopoverPrimitive.Close>
          </div>

          <div className="space-y-3 p-4">
            {presence.status === "unavailable" || checkDelayed ? (
              <button
                type="button"
                onClick={() => void presence.refresh()}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 dark:text-amber-300"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("retryPresence")}
              </button>
            ) : null}

            {loading ? (
              <p className="text-xs text-muted-foreground">{t("loading")}</p>
            ) : loadError ? (
              <div
                role="alert"
                className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3"
              >
                <p className="text-xs leading-relaxed text-destructive">
                  {t("loadError")}
                </p>
                <button
                  type="button"
                  onClick={() => void refreshTokens()}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-destructive/30 px-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
                >
                  {t("retry")}
                </button>
              </div>
            ) : !hasCredential ? (
              <>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("introNoCredential")}
                </p>
                <button
                  type="button"
                  onClick={() => void create("Joblit Runner")}
                  disabled={creating}
                  aria-busy={creating}
                  data-testid="runner-setup-create"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-emerald-600 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-brand-emerald-700 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {t("createCredential")}
                </button>
              </>
            ) : (
              <>
                {command ? (
                  <>
                    <p className="rounded-lg border border-brand-emerald-200 bg-brand-emerald-50/60 px-2.5 py-2 text-[11px] leading-relaxed text-brand-emerald-900 dark:border-brand-emerald-500/30 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-200">
                      {t("rawTokenOnce")}
                    </p>
                    <div
                      role="group"
                      aria-label={t("shellLabel")}
                      className="grid grid-cols-2 rounded-xl bg-muted p-1"
                    >
                      {(["powershell", "bash"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={shell === option}
                          onClick={() => setShell(option)}
                          className="min-h-11 rounded-lg px-2 text-xs font-semibold text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
                        >
                          {option === "powershell" ? "PowerShell" : "Bash"}
                        </button>
                      ))}
                    </div>
                    <CopyRow
                      label={t("startLabel")}
                      value={command}
                      onCopied={handleCommandCopied}
                    />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {t("modelHint")}
                    </p>
                  </>
                ) : (
                  <p className="rounded-xl border border-border/60 bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
                    {t("credentialHidden")}
                  </p>
                )}

                <AlertDialog>
                  <AlertDialogPrimitive.Trigger asChild>
                    <button
                      type="button"
                      disabled={creating}
                      aria-busy={creating}
                      data-testid="runner-setup-regenerate"
                      className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-destructive/25 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
                    >
                      {creating ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {t("regenerate")}
                    </button>
                  </AlertDialogPrimitive.Trigger>
                  <AlertDialogContent className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("replaceTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("replaceDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2">
                      <AlertDialogCancel className="min-h-11">
                        {t("replaceCancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void handleReplace()}
                        className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {t("replaceConfirm")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
