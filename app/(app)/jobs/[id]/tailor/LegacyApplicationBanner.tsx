"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, AlertTriangle, RefreshCcw, Download } from "lucide-react";

interface LegacyApplicationBannerProps {
  applicationId: string;
  jobId: string | null;
  jobTitle: string;
  company: string | null | "";
  resumePdfUrl: string | null;
  /**
   * True when the stored aiContent failed schema validation (drift).
   * Slightly different copy in that case.
   */
  invalidShape?: boolean;
}

export function LegacyApplicationBanner({
  jobId,
  jobTitle,
  company,
  resumePdfUrl,
  invalidShape,
}: LegacyApplicationBannerProps) {
  const t = useTranslations("tailor");
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("backToJobs")}
      </Link>

      <div className="rounded-3xl border border-amber-300/60 bg-amber-50/60 p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              {invalidShape
                ? t("legacy.outOfDateLabel")
                : t("legacy.notEnabledLabel")}
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {jobTitle}
              {company ? (
                <span className="text-muted-foreground"> · {company}</span>
              ) : null}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-foreground/85">
              {invalidShape
                ? t("legacy.outOfDateBody")
                : t("legacy.notEnabledBody")}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {jobId ? (
                <Link
                  href={`/jobs?regenerate=${jobId}`}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition-transform hover:-translate-y-px hover:bg-foreground/90"
                >
                  <RefreshCcw className="h-4 w-4" aria-hidden />
                  {t("legacy.regenerate")}
                </Link>
              ) : null}
              {resumePdfUrl ? (
                <a
                  href={resumePdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-border/70 bg-background px-5 text-sm font-semibold text-foreground transition-colors hover:border-brand-emerald-300/60 hover:bg-muted"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  {t("legacy.downloadCurrentPdf")}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
