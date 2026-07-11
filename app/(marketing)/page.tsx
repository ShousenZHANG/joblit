import type { Metadata } from "next";
import { Cta } from "@/components/landing/Cta";
import { Faq } from "@/components/landing/Faq";
import { Features } from "@/components/landing/Features";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LogoBar } from "@/components/landing/LogoBar";
import { Starfield } from "@/components/landing/Starfield";
import { Access } from "@/components/landing/Access";
import { Nav } from "@/components/landing/Nav";
import { ScrollProgress } from "@/components/landing/ScrollProgress";

/* ── SEO ──────────────────────────────────────────────── */

const TITLE = "AI-tailored resumes for every job you apply to";
const DESC =
  "Fetch roles, generate a custom CV and cover letter matched to each JD, export PDF. One workflow, zero copy-paste.";

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
 * Marketing landing page. Server component that stitches the 9 landing
 * sections from `components/landing/`. Each section is "use client" so it
 * can run framer-motion reveals — but the page shell renders from the
 * server so HTML arrives first for SEO and LCP.
 *
 * Section narrative (Linear/Vercel pattern):
 *   Nav        — sticky navigation + primary CTA
 *   Hero       — what + dual CTA + product mock
 *   LogoBar    — credibility (job boards + LLM providers)
 *   HowItWorks — 3-step flow
 *   Features   — 2×2 differentiators
 *   Access     — free + invite-only apply form
 *   Faq        — objections
 *   Cta        — final push
 *   Footer     — links + legal
 */
export default function MarketingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ScrollProgress />
      {/* Atmosphere: fixed layers rendered behind the page. Kept outside
          <main> so no ancestor transform/overflow establishes a new containing
          block for the fixed Nav inside <main>. Order back→front: starfield
          (dark-only parallax stars) → aurora (drifting blobs) → atmos (radial
          wash) → grain (texture). All z-0, so <main> (z-1) sits on top. */}
      <Starfield />
      <div aria-hidden className="landing-aurora">
        <span className="landing-aurora-blob landing-aurora-blob--1" />
        <span className="landing-aurora-blob landing-aurora-blob--2" />
        <span className="landing-aurora-blob landing-aurora-blob--3" />
        <span className="landing-aurora-blob landing-aurora-blob--4" />
      </div>
      <div aria-hidden className="landing-atmos" />
      <div aria-hidden className="landing-grain" />
      <main id="main-content" className="relative z-[1] flex flex-col bg-transparent text-foreground">
        <Nav />
        <Hero />
        <LogoBar />
        {/* Below-the-fold sections skip layout/paint until they near the
            viewport (content-visibility) — every scroll-reveal animation still
            fires exactly as before; the browser just stops paying for content
            the user hasn't reached yet. */}
        <div className="cv-auto">
          <HowItWorks />
        </div>
        <div className="cv-auto">
          <Features />
        </div>
        <div className="cv-auto">
          <Access />
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
