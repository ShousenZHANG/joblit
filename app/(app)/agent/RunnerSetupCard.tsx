"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Terminal } from "lucide-react";

import { useToast } from "@/hooks/use-toast";

/**
 * Setup guidance for the local Runner.
 *
 * The Hermes key appears only in the snippet the user copies into their own
 * shell. Joblit never receives it, never stores it, and the Runner only ever
 * sends it to the loopback gateway.
 */

const ENV_SNIPPET = [
  'export JOBLIT_URL="{origin}"',
  'export JOBLIT_TOKEN="jfagent_v1_..."',
  'export HERMES_KEY="..."',
].join("\n");

const RUN_COMMAND = "node tools/runner/cli.mjs --watch";

function CommandBlock({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const t = useTranslations("agent.runner");

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    toast({ title: t("copied") });
    setTimeout(() => setCopied(false), 2000);
  }, [command, toast, t]);

  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex items-start gap-2">
        <pre className="agent-token-code flex-1 overflow-x-auto whitespace-pre py-2 text-left">
          {command}
        </pre>
        <button
          type="button"
          onClick={copy}
          aria-label={t("copy")}
          className={`agent-btn-copy ${copied ? "agent-btn-copy--done" : ""}`}
        >
          <span className="agent-btn-copy-inner">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? t("copiedShort") : t("copy")}</span>
          </span>
        </button>
      </div>
    </div>
  );
}

export function RunnerSetupCard({ origin }: { origin: string }) {
  const t = useTranslations("agent.runner");

  return (
    <div className="agent-card mb-6">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-emerald-50">
          <Terminal className="h-4 w-4 text-brand-emerald-600" />
        </div>
        <h2 className="text-sm font-semibold text-foreground/90">{t("title")}</h2>
      </div>

      <p className="text-xs text-muted-foreground">{t("description")}</p>

      <ol className="agent-instructions mt-3">
        <li>
          <span className="agent-step-num">1</span>
          <span>{t("step1")}</span>
        </li>
        <li>
          <span className="agent-step-num">2</span>
          <span>{t("step2")}</span>
        </li>
        <li>
          <span className="agent-step-num">3</span>
          <span>{t("step3")}</span>
        </li>
        <li>
          <span className="agent-step-num">4</span>
          <span>{t("step4")}</span>
        </li>
      </ol>

      <CommandBlock
        label={t("envLabel")}
        command={ENV_SNIPPET.replace("{origin}", origin)}
      />
      <CommandBlock label={t("runLabel")} command={RUN_COMMAND} />

      <p className="mt-3 text-[11px] text-muted-foreground/80">{t("keyNotice")}</p>
    </div>
  );
}
