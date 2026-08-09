"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, Copy, Loader2, Plug, RefreshCw } from "lucide-react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { useAgentTokens } from "@/hooks/useAgentTokens";
import { useRunnerPresence } from "@/hooks/useRunnerPresence";
import { cn } from "@/lib/utils";
import { COARSE_POINTER_TARGET } from "@/components/ui/touchTarget";

/**
 * Runner setup, condensed into the nav.
 *
 * This replaces a whole /agent workspace whose job was, in the end, to hand
 * over one credential and one command. A dedicated page for that made the
 * single most important setup step feel like a separate product — and it was
 * still possible to miss it entirely and click Generate into silence.
 *
 * Three states, in one panel:
 *  - connected: a green line and nothing to do
 *  - credential exists but nothing has called: the command to run
 *  - nothing yet: one button to mint the credential
 *
 * Credentials are single-model here: "Regenerate" revokes the old one and
 * issues a new one. The list-of-credentials UI went with the page; one person
 * running one Runner never needed it, and every extra live credential is
 * extra blast radius.
 */

const START_COMMAND = "node tools/runner/cli.mjs --watch";

function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useTranslations("runnerSetup");
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be denied; the text stays selectable either way.
    }
  }, [value]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-brand-emerald-600" aria-hidden />
              {t("copied")}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden />
              {t("copy")}
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/85">
        {value}
      </pre>
    </div>
  );
}

export function RunnerSetupPopover({ className }: { className?: string }) {
  const t = useTranslations("runnerSetup");
  const [open, setOpen] = useState(false);
  const { tokens, loading, newToken, creating, create, revoke } = useAgentTokens();
  // Presence only matters while the panel is open — an idle workspace should
  // not poll for a Runner nobody is looking at.
  const presence = useRunnerPresence(open);

  // The Jobs page opens this panel when a generation is blocked on setup.
  // An event keeps that one-way call from prop-drilling through the app shell,
  // matching how the command palette is already reached.
  useEffect(() => {
    const openPanel = () => setOpen(true);
    window.addEventListener("joblit:runner-setup", openPanel);
    return () => window.removeEventListener("joblit:runner-setup", openPanel);
  }, []);

  const hasCredential = tokens.length > 0;
  const online = presence.status === "online";

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  // The raw value exists exactly once, in memory, right after minting. A
  // returning user sees the placeholder and regenerates if they lost it.
  const tokenValue = newToken?.rawToken ?? "jfagent_v1_…";
  const envSnippet = `export JOBLIT_URL="${origin}"\nexport JOBLIT_TOKEN="${tokenValue}"`;

  const regenerate = useCallback(async () => {
    // Revoke first so a lost credential cannot outlive its replacement.
    for (const token of tokens) await revoke(token);
    await create("Joblit Runner");
  }, [tokens, revoke, create]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          {/* Present only when connected: an always-on dot is decoration, a
              dot that appears when something is live is information. */}
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
        data-testid="runner-setup-panel"
        className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-0"
      >
        <div className="border-b border-border/60 px-4 py-3">
          <h2 className="text-[13px] font-bold tracking-tight text-foreground">
            {t("title")}
          </h2>
          <p
            data-testid="runner-setup-status"
            className={cn(
              "mt-0.5 flex items-center gap-1.5 text-[11px]",
              online ? "text-brand-emerald-text" : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                online ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            {online ? t("statusOnline") : t("statusOffline")}
          </p>
        </div>

        <div className="space-y-3 p-4">
          {loading ? (
            <p className="text-xs text-muted-foreground">{t("loading")}</p>
          ) : !hasCredential ? (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("introNoCredential")}
              </p>
              <button
                type="button"
                onClick={() => void create("Joblit Runner")}
                disabled={creating}
                data-testid="runner-setup-create"
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-emerald-600 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-brand-emerald-700 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                {t("createCredential")}
              </button>
            </>
          ) : (
            <>
              {newToken ? (
                <p className="rounded-lg border border-brand-emerald-200 bg-brand-emerald-50/60 px-2.5 py-2 text-[11px] leading-relaxed text-brand-emerald-900 dark:border-brand-emerald-500/30 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-200">
                  {t("rawTokenOnce")}
                </p>
              ) : null}
              <CopyRow label={t("step1")} value={envSnippet} />
              <CopyRow label={t("step2")} value={START_COMMAND} />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("modelHint")}
              </p>
              <button
                type="button"
                onClick={() => void regenerate()}
                disabled={creating}
                data-testid="runner-setup-regenerate"
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border/70 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("regenerate")}
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
