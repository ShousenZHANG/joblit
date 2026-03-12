import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { HeroSection } from "./HeroSection";
import { LandingNav } from "./LandingNav";

/* ── SEO ──────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: "Find the right roles, faster",
  description:
    "Fetch jobs, tailor your resume and cover letter, export PDF — in one place.",
  openGraph: {
    title: "Jobflow — Find the right roles, faster",
    description:
      "Fetch jobs, tailor your resume and cover letter, export PDF — in one place.",
    type: "website",
    siteName: "Jobflow",
  },
  twitter: {
    card: "summary_large_image",
    title: "Jobflow — Find the right roles, faster",
    description: "Fetch jobs, tailor your resume and cover letter, export PDF — in one place.",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Jobflow",
  description:
    "Fetch jobs, tailor your resume and cover letter, export PDF — in one place.",
  applicationCategory: "BusinessApplication",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

/* ── Page ─────────────────────────────────────────────── */

export default async function HomePage() {
  const t = await getTranslations("marketing");

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

        <LandingNav />

        <div className="edu-page-enter relative z-[2] mx-auto flex w-full max-w-6xl flex-col items-center gap-16 px-6 pb-12 pt-4 text-center md:gap-20 md:pt-6">
          <main id="main-content">
            <HeroSection
              heroTitle={t("heroTitle")}
              heroSubtitle={t("heroSubtitle")}
              ctaLabel={t("cta")}
              badgeLabel={t("badge")}
            />
          </main>

          <footer
            className="edu-footer-slim mt-auto w-full max-w-5xl text-center"
            role="contentinfo"
          >
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <Link
                href="/"
                className="flex items-center gap-1.5 font-semibold text-slate-900"
              >
                <Search className="h-4 w-4 text-emerald-700" />
                Jobflow
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/privacy" className="hover:text-slate-900">
                Privacy
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/terms" className="hover:text-slate-900">
                Terms
              </Link>
              <span aria-hidden="true">·</span>
              <span>
                &copy; {new Date().getFullYear()} {t("allRightsReserved")}
              </span>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
