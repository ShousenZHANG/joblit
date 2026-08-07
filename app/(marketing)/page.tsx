import type { Metadata } from "next";
import { Cta } from "@/components/landing/Cta";
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
 * Marketing landing page — three movements, nothing else:
 *
 *   Hero + product demo — the product does the talking
 *   LogoBar             — one line of named capability facts, no counters
 *   Cta + Footer        — the close
 *
 * The intro sections (HowItWorks, Features, Faq) and three of the four
 * atmosphere layers were removed by design: prominence through restraint.
 * The starfield stays — it is the one distinctive note, dark-mode only.
 * Every claim on this page is auditable against the codebase; the capability
 * line names what exists rather than counting what might.
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
          <Cta />
        </div>
        <div className="cv-auto">
          <Footer />
        </div>
      </main>
    </>
  );
}
