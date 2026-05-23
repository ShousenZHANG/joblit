import type { Metadata } from "next";
import { Cta } from "@/components/landing/Cta";
import { Faq } from "@/components/landing/Faq";
import { Features } from "@/components/landing/Features";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LogoBar } from "@/components/landing/LogoBar";
import { Nav } from "@/components/landing/Nav";
import { Pricing } from "@/components/landing/Pricing";

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
 *   Pricing    — single free plan
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
      {/* Atmosphere: fixed single-radial gradient rendered behind the page.
          Kept outside <main> so no ancestor transform/overflow establishes
          a new containing block for the fixed Nav inside <main>. */}
      <div aria-hidden className="landing-atmos" />
      <main className="relative z-[1] flex flex-col bg-transparent text-foreground">
        <Nav />
        <Hero />
        <LogoBar />
        <HowItWorks />
        <Features />
        <Pricing />
        <Faq />
        <Cta />
        <Footer />
      </main>
    </>
  );
}
