"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Copy, Download, ExternalLink, Laptop, Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LocalTailorCompanion } from "./useLocalTailorCompanion";

export function CompanionConnectionBar({ companion }: { companion: LocalTailorCompanion }) {
  const t = useTranslations("tailor.companion");
  const [setupOpen, setSetupOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const panelId = useId();
  const { connection, connectionError, status } = companion;
  const pending = connection === "connecting" || connection === "checking";
  const ready = connection === "ready";
  const loginUrl = status?.auth.loginUrl === "https://auth.openai.com/codex/device" ? status.auth.loginUrl : null;
  const code = status?.auth.userCode;
  const copied = !!code && copiedCode === code;
  const stateLabel = t(`connection.${connection}`);
  const connectAction = (
    <Button type="button" size="sm" variant="outline" className="min-h-10 [@media(pointer:coarse)]:min-h-11 rounded-lg text-xs" disabled={!companion.canConnect || pending} onClick={() => void companion.connect()}>
      <PlugZap className="size-3.5" aria-hidden />{t("connect")}
    </Button>
  );

  return (
    <section aria-label={t("title")} className="mb-5 rounded-xl border border-border/70 bg-muted/20">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${ready ? "bg-brand-emerald-500/10 text-brand-emerald-600" : "bg-background text-muted-foreground"}`}>
            {pending ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Laptop className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">{t("title")}</p>
            <p role="status" className={`text-xs leading-5 ${ready ? "text-brand-emerald-700 dark:text-brand-emerald-400" : "text-muted-foreground"}`}>{stateLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {connection === "connecting" ? <Button type="button" variant="ghost" size="sm" className="min-h-10 [@media(pointer:coarse)]:min-h-11 text-xs" onClick={companion.stopConnecting}>{t("stopConnecting")}</Button>
            : connection === "auth-required" ? <Button type="button" size="sm" variant="outline" className="min-h-10 [@media(pointer:coarse)]:min-h-11 text-xs" onClick={() => void companion.startAuth()}>{t("signIn")}</Button>
              : !ready && connection !== "authenticating" ? connectAction : null}
          <Button type="button" variant="ghost" size="sm" className="min-h-10 [@media(pointer:coarse)]:min-h-11 gap-1 rounded-lg px-2 text-xs text-muted-foreground" aria-expanded={setupOpen} aria-controls={panelId} onClick={() => setSetupOpen((value) => !value)}>
            {t(connection === "disconnected" ? "installPrompt" : "setup")}<ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${setupOpen ? "rotate-180" : ""}`} aria-hidden />
          </Button>
        </div>
      </div>

      {connection === "connecting" ? <p className="border-t border-border/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">{t("connectingHelp")}</p> : null}
      {connection === "authenticating" || connection === "auth-required" ? (
        <div className="space-y-2 border-t border-border/50 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{t("authHelp")}</p>
          {loginUrl || code ? <div className="flex flex-wrap items-center gap-2">
            {loginUrl ? <Button asChild size="sm" variant="outline" className="min-h-10 [@media(pointer:coarse)]:min-h-11 text-xs"><a href={loginUrl} target="_blank" rel="noopener noreferrer">{t("openSignIn")}<ExternalLink className="size-3.5" aria-hidden /></a></Button> : null}
            {code ? <><span className="sr-only">{t("deviceCode")}: </span><code className="rounded-lg bg-background px-3 py-2 text-sm font-semibold tracking-wider">{code}</code><Button type="button" variant="ghost" size="sm" className="min-h-10 [@media(pointer:coarse)]:min-h-11 text-xs" aria-label={copied ? t("copied") : t("copyCode")} onClick={() => {
              if (!navigator.clipboard) return;
              void navigator.clipboard.writeText(code).then(() => setCopiedCode(code)).catch(() => setCopiedCode(null));
            }}>{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{copied ? t("copied") : t("copyCode")}</Button></> : null}
          </div> : connection === "authenticating" ? <p role="status" className="text-xs text-muted-foreground">{t("waitingForSignIn")}</p> : null}
        </div>
      ) : null}
      {connectionError ? <div role="alert" className="border-t border-border/50 px-4 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
        <p>{t(`errors.${connectionError.code}`)}</p>
        {connectionError.code === "http" ? <p className="mt-1">{connectionError.message}</p> : null}
        {companion.hasPairing ? <Button type="button" variant="ghost" size="sm" className="mt-1 min-h-10 [@media(pointer:coarse)]:min-h-11 px-2 text-xs" onClick={() => void companion.checkConnection()}>{t("checkConnection")}</Button> : null}
      </div> : null}
      {connection === "unavailable" ? <p className="border-t border-border/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">{t("unavailableHelp")}</p> : null}

      {setupOpen ? <div id={panelId} className="space-y-3 border-t border-border/60 bg-background/60 px-4 py-4">
        <div>
          <h3 className="text-sm font-semibold">{t("setupTitle")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("setupBody")}</p>
        </div>
        <ol className="space-y-2.5 text-xs leading-relaxed text-muted-foreground">
          <li className="flex gap-2.5"><span className="font-semibold text-brand-emerald-600">01</span><span>{t("installStep")}</span></li>
          <li className="flex gap-2.5"><span className="font-semibold text-brand-emerald-600">02</span><span>{t("connectStep")}</span></li>
          <li className="flex gap-2.5"><span className="font-semibold text-brand-emerald-600">03</span><span>{t("generateStep")}</span></li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="min-h-10 [@media(pointer:coarse)]:min-h-11 rounded-lg text-xs"><a href="/api/local-companion/download" download><Download className="size-3.5" aria-hidden />{t("download")}</a></Button>
          {!pending && !ready ? connectAction : null}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("autostart")}</p>
      </div> : null}
    </section>
  );
}
