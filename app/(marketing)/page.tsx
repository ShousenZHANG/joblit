import type { Metadata } from "next";
import { Search } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HeroSection } from "./HeroSection";
import { HowItWorksSection } from "./HowItWorksSection";
import { FeaturesGrid } from "./FeaturesGrid";
import { BeforeAfterSection } from "./BeforeAfterSection";
import { FinalCTA } from "./FinalCTA";
import { LandingBackground } from "./LandingBackground";
import { ScrollProgress } from "./ScrollProgress";

/* ── SEO ──────────────────────────────────────────────── */

const TITLE = "AI-tailored resumes for every job you apply to";
const DESC = "Fetch roles, generate a custom CV and cover letter matched to each JD, export PDF. One workflow, zero copy-paste.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  openGraph: {
    title: `Joblit — ${TITLE}`,
    description: DESC,
    type: "website",
    siteName: "Joblit",
  },
  twitter: {
    card: "summary_large_image",
    title: `Joblit — ${TITLE}`,
    description: DESC,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Joblit",
  description: DESC,
  applicationCategory: "BusinessApplication",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

/* ── Wave Divider ──────────────────────────────────────── */

function WaveDivider() {
  return (
    <div className="relative h-16 w-full sm:h-20" aria-hidden="true">
      <svg
        className="wave-divider absolute inset-0"
        viewBox="0 0 1440 60"
        preserveAspectRatio="none"
        fill="currentColor"
      >
        <path d="M0,30 C240,55 480,5 720,30 C960,55 1200,5 1440,30 L1440,60 L0,60 Z" opacity="0.3" />
        <path d="M0,35 C360,10 720,55 1080,25 C1260,15 1380,35 1440,30 L1440,60 L0,60 Z" opacity="0.15" />
      </svg>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────── */

export default async function HomePage() {
  const t = await getTranslations("marketing");

  return (
    <>
      {/* SAFETY: JSON.stringify produces spec-compliant JSON with no unescaped HTML. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <ScrollProgress />

      <div className="marketing-edu relative min-h-[100dvh] overflow-hidden">
        <div className="edu-bg" aria-hidden="true" />
        <LandingBackground />

        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:border-2 focus:border-slate-800 focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg focus:outline-none"
        >
          {t("skipToContent")}
        </a>

        <div className="edu-page-enter relative z-[2] mx-auto flex w-full max-w-7xl flex-col items-center gap-0 px-4 pb-10 pt-4 text-center sm:px-6 sm:pb-12 md:pt-5 lg:px-8">
          <Link
            href="/"
            className="edu-landing-logo-only self-start text-[15px] font-semibold tracking-tight text-slate-800 transition-colors hover:text-slate-900 focus-visible:outline focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            aria-label="Joblit home"
          >
            <span className="inline-flex items-center gap-2">
              <Search className="h-5 w-5 text-emerald-700" strokeWidth={2.25} />
              Joblit
            </span>
          </Link>

          <main id="main-content" className="flex w-full flex-col items-center">
            <div className="pt-8 sm:pt-12">
              <HeroSection
                heroTitle={t("heroTitle")}
                heroSubtitle={t("heroSubtitle")}
                ctaLabel={t("cta")}
                badgeLabel={t("badge")}
              />
            </div>

            <WaveDivider />
            <HowItWorksSection />
            <WaveDivider />
            <FeaturesGrid />
            <WaveDivider />
            <BeforeAfterSection />
            <WaveDivider />
            <FinalCTA />
          </main>

          <footer
            className="edu-footer-slim mt-auto w-full max-w-5xl pt-10 text-center sm:pt-14"
            role="contentinfo"
          >
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-600">
              <Link
                href="/"
                className="flex items-center gap-1.5 font-semibold text-slate-900"
              >
                <Search className="h-4 w-4 text-emerald-700" />
                Joblit
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/privacy" className="hover:text-slate-900">Privacy</Link>
              <span aria-hidden="true">·</span>
              <Link href="/terms" className="hover:text-slate-900">Terms</Link>
              <span aria-hidden="true">·</span>
              <Link href="/get-extension" className="hover:text-slate-900">
                {t("extensionLink")}
              </Link>
              <span aria-hidden="true">·</span>
              <span>&copy; {new Date().getFullYear()} {t("allRightsReserved")}</span>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
