import type { Metadata } from "next";
import { AiBento } from "@/components/landing/AiBento";
import { Architecture } from "@/components/landing/Architecture";
import { Cta } from "@/components/landing/Cta";
import { Faq } from "@/components/landing/Faq";
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
 * Marketing landing page — five movements, each earning its place:
 *
 *   Hero + product demo — the product does the talking
 *   LogoBar             — one line of named capability facts, no counters
 *   Architecture        — the signature visual: the local-first pipeline,
 *                         with the loopback boundary drawn (ADR-0014/0015)
 *   AiBento             — the AI story as product miniatures, not slogans
 *   Faq                 — the three real objections, then the close
 *
 * The generic intro sections (HowItWorks, the 2×2 feature grid) stayed dead:
 * premium comes from depth in few sections, not from many. Three of the four
 * atmosphere layers are gone; the starfield stays, dark-mode only. Every
 * claim on this page is auditable against the codebase.
 */
export default function MarketingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* One atmosphere layer, dark-only, behind everything. Kept outside
          <main> so no ancestor transform establishes a containing block for
          the fixed Nav. */}
      <Starfield />
      <main className="relative z-[1] flex flex-col bg-transparent text-foreground">
        <Nav />
        <Hero />
        <LogoBar />
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
