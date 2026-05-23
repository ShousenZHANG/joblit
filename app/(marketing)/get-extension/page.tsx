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

export const metadata: Metadata = {
  title: "Joblit AutoFill — Chrome Extension",
  description:
    "Download and install the Joblit AutoFill Chrome extension. Auto-fill job applications on Greenhouse, Lever, Workday, and more.",
};

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
  { name: "Generic Forms", domain: "Any page with form fields" },
];

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
      {n}
    </span>
  );
}

export default async function ExtensionGuidePage() {
  const t = await getTranslations("extensionGuide");
  const tm = await getTranslations("marketing");

  return (
    <div className="marketing-edu relative min-h-[100dvh] overflow-hidden">
      <div className="edu-bg" aria-hidden="true" />

      <div className="relative z-[2] mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {/* Nav */}
        <nav className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-slate-800 transition-colors hover:text-slate-900"
          >
            <Search className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            Joblit
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("backToHome")}
          </Link>
        </nav>

        {/* Hero */}
        <header className="mb-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 shadow-sm">
            <Chrome className="h-8 w-8 text-emerald-700" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
            {t("subtitle")}
          </p>
        </header>

        <div className="space-y-10">
          {/* Step 1: Download */}
          <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={1} />
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  <Download className="mr-2 inline-block h-5 w-5 text-emerald-600" />
                  {t("downloadTitle")}
                </h2>
              </div>
            </div>
            <p className="mb-4 text-sm text-slate-600">{t("downloadDesc")}</p>
            <a
              href="https://github.com/ShousenZHANG/joblit/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              {t("downloadBtn")}
            </a>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("downloadNote")}
            </p>
          </section>

          {/* Step 2: Install */}
          <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={2} />
              <h2 className="text-lg font-semibold text-slate-900">
                <Chrome className="mr-2 inline-block h-5 w-5 text-emerald-600" />
                {t("installTitle")}
              </h2>
            </div>
            <ol className="space-y-3 text-sm text-slate-700">
              {(["installStep1", "installStep2", "installStep3", "installStep4", "installStep5"] as const).map(
                (key, i) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                      {i + 1}
                    </span>
                    <span>
                      {key === "installStep2" ? (
                        <>
                          {t("installStep2").split("chrome://extensions")[0]}
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-emerald-700">
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
            <div className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <strong>Tip:</strong> {t("installTip")}
            </div>
          </section>

          {/* Step 3: Account */}
          <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={3} />
              <h2 className="text-lg font-semibold text-slate-900">
                <UserPlus className="mr-2 inline-block h-5 w-5 text-emerald-600" />
                {t("accountTitle")}
              </h2>
            </div>
            <p className="mb-4 text-sm text-slate-600">{t("accountDesc")}</p>
            <ol className="mb-4 space-y-2 text-sm text-slate-700">
              {(["accountStep1", "accountStep2", "accountStep3"] as const).map(
                (key, i) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                      {i + 1}
                    </span>
                    <span>{t(key)}</span>
                  </li>
                ),
              )}
            </ol>
            <Link
              href="/login?callbackUrl=/resume"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
            >
              {t("accountBtn")}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </section>

          {/* Step 4: Token */}
          <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={4} />
              <h2 className="text-lg font-semibold text-slate-900">
                <KeyRound className="mr-2 inline-block h-5 w-5 text-emerald-600" />
                {t("tokenTitle")}
              </h2>
            </div>
            <p className="mb-4 text-sm text-slate-600">{t("tokenDesc")}</p>
            <ol className="mb-4 space-y-2 text-sm text-slate-700">
              {(["tokenStep1", "tokenStep2", "tokenStep3"] as const).map(
                (key, i) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                      {i + 1}
                    </span>
                    <span>{t(key)}</span>
                  </li>
                ),
              )}
            </ol>
            <Link
              href="/extension"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <KeyRound className="h-4 w-4" />
              {t("tokenBtn")}
            </Link>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("tokenNote")}
            </p>
          </section>

          {/* Step 5: Connect */}
          <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={5} />
              <h2 className="text-lg font-semibold text-slate-900">
                <Link2 className="mr-2 inline-block h-5 w-5 text-emerald-600" />
                {t("connectTitle")}
              </h2>
            </div>
            <ol className="space-y-2 text-sm text-slate-700">
              {(["connectStep1", "connectStep2", "connectStep3"] as const).map(
                (key, i) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                      {i + 1}
                    </span>
                    <span>{t(key)}</span>
                  </li>
                ),
              )}
            </ol>
          </section>

          {/* Usage Methods */}
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-sm font-bold text-emerald-800">
                <Zap className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-semibold text-slate-900">
                {t("useTitle")}
              </h2>
            </div>
            <p className="mb-5 text-sm text-slate-600">{t("useDesc")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: MousePointer, titleKey: "useMethod1Title" as const, descKey: "useMethod1Desc" as const },
                { icon: Keyboard, titleKey: "useMethod2Title" as const, descKey: "useMethod2Desc" as const },
                { icon: Layers, titleKey: "useMethod3Title" as const, descKey: "useMethod3Desc" as const },
              ].map(({ icon: Icon, titleKey, descKey }) => (
                <div
                  key={titleKey}
                  className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm"
                >
                  <Icon className="mb-2 h-5 w-5 text-emerald-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t(titleKey)}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">{t(descKey)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Supported Platforms */}
          <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">
              {t("supportedTitle")}
            </h2>
            <p className="mb-4 text-sm text-slate-600">
              {t("supportedDesc")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ATS_PLATFORMS.map((ats) => (
                <div
                  key={ats.name}
                  className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-100 text-xs font-bold text-emerald-700">
                    {ats.name[0]}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-800">
                      {ats.name}
                    </div>
                    <div className="text-xs text-slate-500">{ats.domain}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
            <h2 className="mb-5 text-lg font-semibold text-slate-900">
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
                  className="group rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
                    <Icon className="h-4 w-4 shrink-0 text-emerald-600" />
                    {t(q)}
                    <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-2 pl-6 text-sm text-slate-600">{t(a)}</p>
                </details>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-600">
            <Link
              href="/"
              className="flex items-center gap-1.5 font-semibold text-slate-900"
            >
              <Search className="h-4 w-4 text-emerald-700" />
              Joblit
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link href="/privacy" className="hover:text-slate-900">
              Privacy
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link href="/terms" className="hover:text-slate-900">
              Terms
            </Link>
            <span aria-hidden="true">&middot;</span>
            <span>
              &copy; {new Date().getFullYear()} {tm("allRightsReserved")}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
