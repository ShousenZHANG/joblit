import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BarChart3,
  FileText,
  Search,
  Send,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DemoCard } from "./DemoCard";
import { MobileNav } from "./MobileNav";

/* ── SEO ──────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: "Find the right roles, faster",
  description:
    "Search smarter, compare quickly, and move with clarity. Jobflow helps you discover, track, and apply to jobs with confidence.",
  openGraph: {
    title: "Jobflow — Find the right roles, faster",
    description:
      "Search smarter, compare quickly, and move with clarity. Discover, track, and apply to jobs with confidence.",
    type: "website",
    siteName: "Jobflow",
  },
  twitter: {
    card: "summary_large_image",
    title: "Jobflow — Find the right roles, faster",
    description:
      "Search smarter, compare quickly, and move with clarity.",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Jobflow",
  description:
    "Search smarter, compare quickly, and move with clarity. Jobflow helps you discover, track, and apply to jobs with confidence.",
  applicationCategory: "BusinessApplication",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

/* ── Static data ──────────────────────────────────────── */

const featureIcons = [
  { icon: Search, accent: "bg-emerald-100" },
  { icon: BarChart3, accent: "bg-sky-100" },
  { icon: FileText, accent: "bg-amber-100" },
  { icon: Zap, accent: "bg-purple-100" },
];

const stepIcons = [
  { number: "1", icon: Search },
  { number: "2", icon: SlidersHorizontal },
  { number: "3", icon: Send },
];

/* ── Page ─────────────────────────────────────────────── */

export default async function HomePage() {
  const t = await getTranslations("marketing");
  const tn = await getTranslations("nav");

  const features = [
    { ...featureIcons[0], title: t("feature1Title"), description: t("feature1Desc") },
    { ...featureIcons[1], title: t("feature2Title"), description: t("feature2Desc") },
    { ...featureIcons[2], title: t("feature3Title"), description: t("feature3Desc") },
    { ...featureIcons[3], title: t("feature4Title"), description: t("feature4Desc") },
  ];

  const steps = [
    { ...stepIcons[0], title: t("step1Title"), description: t("step1Desc") },
    { ...stepIcons[1], title: t("step2Title"), description: t("step2Desc") },
    { ...stepIcons[2], title: t("step3Title"), description: t("step3Desc") },
  ];
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="marketing-edu relative min-h-[100dvh] overflow-hidden">
        {/* Decorative background */}
        <div className="edu-bg" aria-hidden="true" />
        <div className="edu-blob edu-blob--mint" aria-hidden="true" />
        <div className="edu-blob edu-blob--peach" aria-hidden="true" />

        {/* Skip to content */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:border-2 focus:border-slate-800 focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg focus:outline-none"
        >
          {t("skipToContent")}
        </a>

        {/* ── Navigation ─────────────────────── */}
        <div className="edu-page-enter relative z-[2] mx-auto flex w-full max-w-6xl flex-col items-center gap-16 px-6 py-8 text-center md:gap-20">
          <nav
            aria-label="Main navigation"
            className="edu-nav edu-nav--press w-full max-w-5xl"
          >
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="flex items-center gap-3"
                aria-label="Jobflow home"
              >
                <div className="edu-logo">
                  <Search className="h-5 w-5 text-emerald-700" />
                </div>
                <span className="text-lg font-semibold text-slate-900">
                  Jobflow
                </span>
              </Link>
              <div className="hidden items-center gap-2 md:flex">
                <Link href="/jobs" className="edu-nav-link edu-nav-pill">
                  {tn("jobs")}
                </Link>
                <Link href="/fetch" className="edu-nav-link edu-nav-pill">
                  {tn("fetch")}
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <MobileNav />
              <Button
                asChild
                variant="outline"
                className="edu-outline edu-cta--press hidden md:inline-flex"
              >
                <Link href="/login">{t("login")}</Link>
              </Button>
              <Button
                asChild
                className="edu-cta edu-cta--press hidden md:inline-flex"
              >
                <Link href="/login">{t("cta")}</Link>
              </Button>
            </div>
          </nav>

          {/* ── Main content ─────────────────── */}
          <main id="main-content">
            {/* Hero */}
            <header className="grid w-full max-w-5xl gap-10 text-center lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:text-left">
              <div className="edu-enter flex flex-col items-center lg:items-start">
                <Badge className="edu-pill">
                  <span
                    className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500"
                    aria-hidden="true"
                  />
                  {t("badge")}
                </Badge>
                <h1 className="edu-title mt-6 text-4xl leading-tight text-slate-900 md:text-6xl">
                  {t("heroTitle")}
                </h1>
                <p className="mt-5 max-w-xl text-base text-slate-600 md:text-lg">
                  {t("heroSubtitle")}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
                  <Button
                    asChild
                    size="lg"
                    className="edu-cta edu-cta--press"
                  >
                    <Link href="/login">
                      Start searching <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="edu-outline edu-cta--press"
                  >
                    <Link href="/jobs">Open dashboard</Link>
                  </Button>
                </div>
                <div className="mt-8 grid w-full max-w-md grid-cols-3 gap-6 text-sm text-slate-600 lg:max-w-none">
                  <div>
                    <div className="text-2xl font-semibold text-slate-900">
                      1.2k+
                    </div>
                    Roles indexed
                  </div>
                  <div>
                    <div className="text-2xl font-semibold text-slate-900">
                      1 min
                    </div>
                    Avg. shortlist
                  </div>
                  <div>
                    <div className="text-2xl font-semibold text-slate-900">
                      2.4x
                    </div>
                    Faster discovery
                  </div>
                </div>
              </div>

              <div className="edu-enter delay-1 flex w-full items-center justify-center lg:justify-end">
                <DemoCard />
              </div>
            </header>

            {/* ── Features ───────────────────── */}
            <section
              aria-labelledby="features-heading"
              className="mt-20 w-full max-w-5xl md:mt-28"
            >
              <h2
                id="features-heading"
                className="edu-title text-2xl text-slate-900 md:text-4xl"
              >
                {t("heroTitle")}
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600 md:text-lg">
                {t("heroSubtitle")}
              </p>
              <div className="mt-10 grid gap-6 text-left sm:grid-cols-2 lg:grid-cols-4">
                {features.map((f) => (
                  <div key={f.title} className="edu-feature-card">
                    <div className={`edu-feature-icon ${f.accent}`}>
                      <f.icon className="h-5 w-5 text-slate-700" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-slate-900">
                      {f.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {f.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* ── How it works ───────────────── */}
            <section
              aria-labelledby="how-heading"
              className="mt-20 w-full max-w-5xl md:mt-28"
            >
              <h2
                id="how-heading"
                className="edu-title text-2xl text-slate-900 md:text-4xl"
              >
                {t("howItWorks")}
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600 md:text-lg">
                {t("heroSubtitle")}
              </p>
              <div className="mt-10 grid gap-8 text-left md:grid-cols-3">
                {steps.map((s) => (
                  <div key={s.number} className="edu-step-card">
                    <div className="edu-step-number" aria-hidden="true">
                      {s.number}
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-slate-900">
                      {s.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {s.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Final CTA ──────────────────── */}
            <section
              aria-labelledby="cta-heading"
              className="mt-20 w-full max-w-3xl md:mt-28"
            >
              <div className="edu-cta-banner text-center">
                <h2
                  id="cta-heading"
                  className="edu-title text-2xl text-slate-900 md:text-4xl"
                >
                  {t("readyToStart")}
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-slate-600 md:text-lg">
                  {t("readyToStartDesc")}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Button
                    asChild
                    size="lg"
                    className="edu-cta edu-cta--press"
                  >
                    <Link href="/login">
                      {t("getStarted")} <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </section>
          </main>

          {/* ── Footer ───────────────────────── */}
          <footer
            className="edu-footer mt-4 w-full max-w-5xl text-left"
            role="contentinfo"
          >
            <div className="grid gap-8 md:grid-cols-[1.2fr_1fr_1fr]">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <div className="edu-logo h-10 w-10">
                    <Search className="h-4 w-4 text-emerald-700" />
                  </div>
                  Jobflow
                </div>
                <p className="text-sm text-slate-600">
                  A calm space to search faster and keep your job hunt on track.
                </p>
              </div>
              <nav aria-label="Explore links" className="space-y-2 text-sm">
                <div className="font-semibold text-slate-900">Explore</div>
                <Link
                  href="/jobs"
                  className="block text-slate-600 transition-colors hover:text-slate-900"
                >
                  Saved roles
                </Link>
                <Link
                  href="/jobs"
                  className="block text-slate-600 transition-colors hover:text-slate-900"
                >
                  Recent searches
                </Link>
                <Link
                  href="/jobs"
                  className="block text-slate-600 transition-colors hover:text-slate-900"
                >
                  Career tips
                </Link>
              </nav>
              <nav aria-label="Support links" className="space-y-2 text-sm">
                <div className="font-semibold text-slate-900">Support</div>
                <a
                  href="mailto:support@jobflow.app"
                  className="block text-slate-600 transition-colors hover:text-slate-900"
                >
                  Help center
                </a>
                <a
                  href="mailto:hello@jobflow.app"
                  className="block text-slate-600 transition-colors hover:text-slate-900"
                >
                  Contact
                </a>
                <Link
                  href="/privacy"
                  className="block text-slate-600 transition-colors hover:text-slate-900"
                >
                  Privacy
                </Link>
              </nav>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
              <span>
                &copy; {new Date().getFullYear()} Jobflow. {t("allRightsReserved")}
              </span>
              <div className="flex items-center gap-4">
                <Link
                  href="/terms"
                  className="transition-colors hover:text-slate-900"
                >
                  Terms
                </Link>
                <Link
                  href="/cookies"
                  className="transition-colors hover:text-slate-900"
                >
                  Cookies
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
