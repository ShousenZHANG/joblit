"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Cpu, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  detectLocalAiAvailability,
  type LocalAiDetectionState,
} from "@/lib/client/localAiBridge";

type WebsiteStatus = "detecting" | LocalAiDetectionState;

export function LocalAiSetupCard() {
  const t = useTranslations("extension.localAi");
  const [status, setStatus] = useState<WebsiteStatus>("detecting");
  const [showSettingsGuide, setShowSettingsGuide] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("detecting");
    const nextStatus = await detectLocalAiAvailability({ signal: controller.signal });
    if (!controller.signal.aborted) setStatus(nextStatus);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    void detectLocalAiAvailability({ signal: controller.signal }).then((nextStatus) => {
      if (!controller.signal.aborted) setStatus(nextStatus);
    });
    return () => controller.abort();
  }, []);

  const displayState =
    status === "detecting"
      ? "detecting"
      : status === "extension_missing"
        ? "extensionMissing"
        : status === "bridge_error"
          ? "bridgeError"
        : status === "joblit_disconnected"
          ? "joblitDisconnected"
          : status === "ready"
            ? "ready"
            : "setupRequired";

  return (
    <section className="ext-card mb-6" aria-labelledby="local-ai-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-700 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300">
            {status === "detecting" ? (
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
            ) : status === "ready" ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            ) : (
              <Cpu className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="local-ai-heading" className="text-sm font-semibold text-foreground/90">
                {t("title")}
              </h2>
              <span className="rounded-full border border-brand-emerald-200 bg-brand-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-emerald-700">
                {t("betaBadge")}
              </span>
            </div>
            <p aria-live="polite" className="mt-1 text-sm font-medium text-foreground">
              {t(`states.${displayState}`)}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              {t("browserDisclosure")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void check()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
            {t("checkAgain")}
          </Button>
          {status === "extension_missing" ? (
            <Button asChild size="sm" className="rounded-xl bg-brand-emerald-600 text-white hover:bg-brand-emerald-700">
              <Link href="/get-extension">{t("install")}</Link>
            </Button>
          ) : status !== "ready" && status !== "detecting" ? (
            <Button
              size="sm"
              className="rounded-xl bg-brand-emerald-600 text-white hover:bg-brand-emerald-700"
              onClick={() => setShowSettingsGuide((value) => !value)}
            >
              <Settings2 className="mr-2 h-3.5 w-3.5" aria-hidden />
              {t("openSettings")}
            </Button>
          ) : null}
        </div>
      </div>

      {showSettingsGuide ? (
        <p className="mt-4 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {t("settingsGuide")}
        </p>
      ) : null}
    </section>
  );
}
