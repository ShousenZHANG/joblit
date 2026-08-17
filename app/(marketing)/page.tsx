import type { Metadata } from "next";
import { AiBento } from "@/components/landing/AiBento";
import { Architecture } from "@/components/landing/Architecture";
import { Cta } from "@/components/landing/Cta";
import { Faq } from "@/components/landing/Faq";
import { Flow } from "@/components/landing/Flow";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { LogoBar } from "@/components/landing/LogoBar";
import { Starfield } from "@/components/landing/Starfield";
import { Nav } from "@/components/landing/Nav";

/* ── SEO ──────────────────────────────────────────────── */

const TITLE = "AI-tailored resumes for every job you apply to";
const DESC =
  "Bring role discovery, JD-matched resume and cover-letter workflows, and PDF export into one focused workspace.";

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

/* ── Page ─────────────────────────────────────────────── */

/**
 * Marketing landing page — six movements, each earning its place:
 *
 *   Hero + product demo — the product does the talking
 *   LogoBar             — one line of named capability facts, no counters
 *   Flow                — the four-stage loop, drawn from real UI fragments
 *   Architecture        — the signature visual: workspace → your chatbot →
 *                         deterministic gates → PDF (ADR-0015/0022/0023)
 *   AiBento             — the AI story as product miniatures, not slogans
 *   Faq                 — the three real objections, then the close
 *
 * An earlier generic HowItWorks (icons + verbs) stayed dead; Flow replaced it
 * only once every step could carry a miniature of the real surface. Three of
 * the four atmosphere layers are gone; the starfield stays, dark-mode only.
 *
 * Every claim on this page is auditable against the codebase — which makes
 * the page itself load-bearing: any change that retires or reshapes a piece
 * of the architecture must update this page in the same change, or the
 * landing starts lying about the product it fronts.
 */
export default function MarketingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* One atmosphere layer per theme, behind everything. Kept outside
          <main> so no ancestor transform establishes a containing block for
          the fixed Nav. Light: cool near-white paper so pure-white cards
          read as layers. Dark: the starfield. */}
      <div aria-hidden className="landing-paper dark:hidden" />
      <Starfield />
      <main className="marketing-cool relative z-[1] flex flex-col bg-transparent text-foreground">
        <Nav />
        <Hero />
        <LogoBar />
        <div className="cv-auto">
          <Flow />
        </div>
        <div className="cv-auto">
          <Architecture />
        </div>
        <div className="cv-auto">
          <AiBento />
        </div>
        <div className="cv-auto">
          <Faq />
        </div>
        <div className="cv-auto">
          <Cta />
        </div>
        <div className="cv-auto">
          <Footer />
        </div>
      </main>
    </>
  );
}
