"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  TerminalSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRunnerPresence } from "@/hooks/useRunnerPresence";
import { cn } from "@/lib/utils";
import type { AgentTokensApi } from "./useAgentTokens";

/**
 * Onboarding that knows where you are.
 *
 * The old setup card was a static leaflet: four numbered sentences and two
 * command blocks, identical before and after you had done any of it. This
 * stepper derives progress from the system itself — the token step checks off
 * when a live credential exists, the connect step checks off when presence
 * turns online — and the freshly minted raw token is injected straight into
 * the copyable snippet, so nobody stitches placeholders together by hand.
 *
 * The raw token appears only while this mount holds it in memory (the server
 * returns it exactly once). HERMES_KEY is never known to Joblit and stays a
 * placeholder by design.
 *
 * Once everything is green the card collapses to one summary line; the full
 * guide stays one click away.
 */

function buildSnippet(origin: string, rawToken: string | null): string {
  return [
    `export JOBLIT_URL="${origin}"`,
    `export JOBLIT_TOKEN="${rawToken ?? "jfagent_v1_..."}"`,
    'export HERMES_KEY="your-hermes-key"',
    "node tools/runner/cli.mjs --watch",
  ].join("\n");
}

function StepMarker({
  done,
  index,
}: {
  done: boolean;
  index: number;
}) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
        done
          ? "border-brand-emerald-300 bg-brand-emerald-50 text-brand-emerald-700 dark:border-brand-emerald-500/40 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300"
          : "border-border bg-background text-muted-foreground",
      )}
      aria-hidden
    >
      {done ? <Check className="h-3.5 w-3.5" /> : index}
    </span>
  );
}

export function RunnerSetupStepper({
  origin,
  tokensApi,
}: {
  origin: string;
  tokensApi: AgentTokensApi;
}) {
  const t = useTranslations("agent.setup");
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [expandedWhenDone, setExpandedWhenDone] = useState(false);

  const hasToken = tokensApi.tokens.length > 0;
  const presence = useRunnerPresence(true);
  const connected = presence.status === "online";
  const allDone = hasToken && connected;

  const snippet = buildSnippet(origin, tokensApi.newToken?.rawToken ?? null);

  const copySnippet = useCallback(async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    toast({ title: t("copied") });
    setTimeout(() => setCopied(false), 2000);
  }, [snippet, toast, t]);

  if (allDone && !expandedWhenDone) {
    return (
      <div
        data-testid="runner-setup-collapsed"
        className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-brand-emerald-200/70 bg-brand-emerald-50/50 px-4 py-3 dark:border-brand-emerald-500/25 dark:bg-brand-emerald-500/[0.07]"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-emerald-800 dark:text-brand-emerald-300">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {t("collapsedSummary")}
        </span>
        <button
          type="button"
          onClick={() => setExpandedWhenDone(true)}
          className="inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("showGuide")}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <section
      data-testid="runner-setup-stepper"
      aria-label={t("title")}
      className="agent-card mb-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-emerald-50">
          <TerminalSquare className="h-4 w-4 text-brand-emerald-600" aria-hidden />
        </div>
        <h2 className="text-sm font-semibold text-foreground/90">{t("title")}</h2>
      </div>

      <ol className="space-y-4">
        {/* ① Hermes gateway — a manual prerequisite; nothing to detect. */}
        <li className="flex items-start gap-3">
          <StepMarker done={false} index={1} />
          <div className="min-w-0 pt-0.5">
            <p className="text-sm font-medium text-foreground">
              {t("stepGatewayTitle")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("stepGatewayDesc")}
            </p>
          </div>
        </li>

        {/* ② Credential — checks itself off, and creation lives right here. */}
        <li className="flex items-start gap-3" data-testid="setup-step-token">
          <StepMarker done={hasToken} index={2} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">
              {t("stepTokenTitle")}
            </p>
            {hasToken ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("stepTokenDone")}
              </p>
            ) : (
              <Button
                size="sm"
                disabled={tokensApi.creating}
                onClick={() => void tokensApi.create()}
                className="mt-2 h-9 rounded-lg"
              >
                {tokensApi.creating ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {t("stepTokenCreate")}
              </Button>
            )}
          </div>
        </li>

        {/* ③ Configure & start — one block, one copy. */}
        <li className="flex items-start gap-3">
          <StepMarker done={false} index={3} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">
              {t("stepConfigureTitle")}
            </p>
            <div className="mt-2 flex items-start gap-2">
              <pre
                data-testid="setup-snippet"
                className="agent-token-code flex-1 overflow-x-auto whitespace-pre py-2 text-left"
              >
                {snippet}
              </pre>
              <button
                type="button"
                onClick={() => void copySnippet()}
                aria-label={t("copy")}
                className={`agent-btn-copy ${copied ? "agent-btn-copy--done" : ""}`}
              >
                <span className="agent-btn-copy-inner">
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copied ? t("copiedShort") : t("copy")}</span>
                </span>
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground/80">
              {tokensApi.newToken ? t("snippetTokenLive") : t("snippetTokenPending")}
              {" "}
              {t("snippetHermesNote")}
            </p>
          </div>
        </li>

        {/* ④ Connected — the page notices for you. */}
        <li className="flex items-start gap-3" data-testid="setup-step-connect">
          <StepMarker done={connected} index={4} />
          <div className="min-w-0 pt-0.5">
            <p className="text-sm font-medium text-foreground">
              {t("stepConnectTitle")}
            </p>
            {connected ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-brand-emerald-700 dark:text-brand-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                {t("stepConnectDone")}
              </p>
            ) : (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2
                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
                {t("stepConnectWaiting")}
              </p>
            )}
          </div>
        </li>
      </ol>

      {allDone && expandedWhenDone ? (
        <button
          type="button"
          onClick={() => setExpandedWhenDone(false)}
          className="mt-4 inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("hideGuide")}
          <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
        </button>
      ) : null}
    </section>
  );
}
