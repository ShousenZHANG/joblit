import type { Metadata } from "next";
import Link from "next/link";
import {
  Search,
  ArrowLeft,
  Download,
  Chrome,
  UserPlus,
  KeyRound,
  Link2,
  Zap,
  Keyboard,
  MousePointer,
  ChevronRight,
  Shield,
  RefreshCcw,
  Layers,
  Clock,
  Brain,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("extensionGuide");
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

const ATS_PLATFORMS = [
  { name: "Greenhouse", domain: "boards.greenhouse.io" },
  { name: "Lever", domain: "jobs.lever.co" },
  { name: "Workday", domain: "*.myworkdayjobs.com" },
  { name: "iCIMS", domain: "*.icims.com" },
  { name: "SuccessFactors", domain: "*.successfactors.com" },
  { name: "Taleo", domain: "*.taleo.net" },
  { name: "SmartRecruiters", domain: "*.smartrecruiters.com" },
  { name: "BambooHR", domain: "*.bamboohr.com" },
  { name: "Jobvite", domain: "*.jobvite.com" },
  { name: "Ashby", domain: "*.ashbyhq.com" },
  { name: "Rippling", domain: "*.rippling.com" },
];

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-emerald-50 text-sm font-bold text-brand-emerald-text">
      {n}
    </span>
  );
}

export default async function ExtensionGuidePage() {
  const t = await getTranslations("extensionGuide");
  const tm = await getTranslations("marketing");
  const platforms = [
    ...ATS_PLATFORMS,
    { name: t("genericForms"), domain: t("genericFormsDomain") },
  ];

  return (
    <main className="extension-guide-surface marketing-edu relative min-h-[100dvh] overflow-hidden">
      <div className="edu-bg" aria-hidden="true" />

      <div className="relative z-[2] mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {/* Nav */}
        <nav className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-foreground transition-colors hover:text-brand-emerald-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Search className="h-4 w-4 text-brand-emerald-text" aria-hidden="true" />
            Joblit
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("backToHome")}
          </Link>
        </nav>

        {/* Hero */}
        <header id="main-content" tabIndex={-1} className="mb-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-emerald-50 shadow-sm">
            <Chrome className="h-8 w-8 text-brand-emerald-text" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground">
            {t("subtitle")}
          </p>
        </header>

        <div className="space-y-10">
          {/* Step 1: Download */}
          <section className="rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={1} />
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  <Download className="mr-2 inline-block h-5 w-5 text-brand-emerald-600" />
                  {t("downloadTitle")}
                </h2>
              </div>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">{t("downloadDesc")}</p>
            <a
              href="https://github.com/ShousenZHANG/jobflow-web/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Download className="h-4 w-4" />
              {t("downloadBtn")}
            </a>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {t("downloadNote")}
            </p>
          </section>

          {/* Step 2: Install */}
          <section className="rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={2} />
              <h2 className="text-lg font-semibold text-foreground">
                <Chrome className="mr-2 inline-block h-5 w-5 text-brand-emerald-600" />
                {t("installTitle")}
              </h2>
            </div>
            <ol className="space-y-3 text-sm text-muted-foreground">
              {(["installStep1", "installStep2", "installStep3", "installStep4", "installStep5"] as const).map(
                (key, i) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span>
                      {key === "installStep2" ? (
                        <>
                          {t("installStep2").split("chrome://extensions")[0]}
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-brand-emerald-text">
                            chrome://extensions
                          </code>
                          {t("installStep2").split("chrome://extensions")[1]}
                        </>
                      ) : (
                        t(key)
                      )}
                    </span>
                  </li>
                ),
              )}
            </ol>
            <div className="mt-4 rounded-lg bg-brand-emerald-50 px-3 py-2 text-xs text-brand-emerald-800">
              <strong>{t("tipLabel")}:</strong> {t("installTip")}
            </div>
          </section>

          {/* Step 3: Account */}
          <section className="rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={3} />
              <h2 className="text-lg font-semibold text-foreground">
                <UserPlus className="mr-2 inline-block h-5 w-5 text-brand-emerald-600" />
                {t("accountTitle")}
              </h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">{t("accountDesc")}</p>
            <ol className="mb-4 space-y-2 text-sm text-muted-foreground">
              {(["accountStep1", "accountStep2", "accountStep3"] as const).map(
                (key, i) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span>{t(key)}</span>
                  </li>
                ),
              )}
            </ol>
            <Link
              href="/login?callbackUrl=/resume"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-background shadow-sm transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {t("accountBtn")}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </section>

          {/* Step 4: Token */}
          <section className="rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={4} />
              <h2 className="text-lg font-semibold text-foreground">
                <KeyRound className="mr-2 inline-block h-5 w-5 text-brand-emerald-600" />
                {t("tokenTitle")}
              </h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">{t("tokenDesc")}</p>
            <ol className="mb-4 space-y-2 text-sm text-muted-foreground">
              {(["tokenStep1", "tokenStep2", "tokenStep3"] as const).map(
                (key, i) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span>{t(key)}</span>
                  </li>
                ),
              )}
            </ol>
            <Link
              href="/extension"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <KeyRound className="h-4 w-4" />
              {t("tokenBtn")}
            </Link>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {t("tokenNote")}
            </p>
          </section>

          {/* Step 5: Connect */}
          <section className="rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={5} />
              <h2 className="text-lg font-semibold text-foreground">
                <Link2 className="mr-2 inline-block h-5 w-5 text-brand-emerald-600" />
                {t("connectTitle")}
              </h2>
            </div>
            <ol className="space-y-2 text-sm text-muted-foreground">
              {(["connectStep1", "connectStep2", "connectStep3"] as const).map(
                (key, i) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span>{t(key)}</span>
                  </li>
                ),
              )}
            </ol>
          </section>

          {/* Usage Methods */}
          <section className="rounded-2xl border border-brand-emerald-200 bg-brand-emerald-50/50 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-emerald-100 text-sm font-bold text-brand-emerald-800">
                <Zap className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-semibold text-foreground">
                {t("useTitle")}
              </h2>
            </div>
            <p className="mb-5 text-sm text-muted-foreground">{t("useDesc")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: MousePointer, titleKey: "useMethod1Title" as const, descKey: "useMethod1Desc" as const },
                { icon: Keyboard, titleKey: "useMethod2Title" as const, descKey: "useMethod2Desc" as const },
                { icon: Layers, titleKey: "useMethod3Title" as const, descKey: "useMethod3Desc" as const },
              ].map(({ icon: Icon, titleKey, descKey }) => (
                <div
                  key={titleKey}
                  className="rounded-xl border border-brand-emerald-200 bg-card p-4 shadow-sm"
                >
                  <Icon className="mb-2 h-5 w-5 text-brand-emerald-600" />
                  <h3 className="text-sm font-semibold text-foreground">
                    {t(titleKey)}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t(descKey)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Supported Platforms */}
          <section className="rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              {t("supportedTitle")}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t("supportedDesc")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {platforms.map((ats) => (
                <div
                  key={ats.name}
                  className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/50 px-4 py-2.5"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-emerald-50 text-xs font-bold text-brand-emerald-text">
                    {ats.name[0]}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {ats.name}
                    </div>
                    <div className="text-xs text-muted-foreground">{ats.domain}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section className="rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur">
            <h2 className="mb-5 text-lg font-semibold text-foreground">
              {t("faqTitle")}
            </h2>
            <div className="space-y-4">
              {[
                { q: "faq1Q" as const, a: "faq1A" as const, icon: Shield },
                { q: "faq2Q" as const, a: "faq2A" as const, icon: RefreshCcw },
                { q: "faq3Q" as const, a: "faq3A" as const, icon: Layers },
                { q: "faq4Q" as const, a: "faq4A" as const, icon: Clock },
                { q: "faq5Q" as const, a: "faq5A" as const, icon: Brain },
              ].map(({ q, a, icon: Icon }) => (
                <details
                  key={q}
                  className="group rounded-lg border border-border/60 bg-muted/50 px-4 py-3"
                >
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
                    <Icon className="h-4 w-4 shrink-0 text-brand-emerald-600" />
                    {t(q)}
                    <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-2 pl-6 text-sm text-muted-foreground">{t(a)}</p>
                </details>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Search className="h-4 w-4 text-brand-emerald-text" />
              Joblit
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link href="/privacy" className="inline-flex min-h-11 items-center rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              {tm("privacy")}
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link href="/terms" className="inline-flex min-h-11 items-center rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              {tm("terms")}
            </Link>
            <span aria-hidden="true">&middot;</span>
            <span>
              &copy; {new Date().getFullYear()} {tm("allRightsReserved")}
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}
