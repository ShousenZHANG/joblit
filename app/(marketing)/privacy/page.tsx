import type { Metadata } from "next";
import Link from "next/link";
import { Search, ArrowLeft, ArrowRight, Shield } from "lucide-react";
import { getTranslations } from "next-intl/server";
import LegalTableOfContents from "../LegalTableOfContents";

export const metadata: Metadata = {
  title: "Privacy Policy — Joblit",
  description: "How Joblit collects, uses, and protects your data.",
};

const TOC_ITEMS = [
  { id: "info-collect", label: "1. Information We Collect" },
  { id: "how-use", label: "2. How We Use Your Info" },
  { id: "ai-processing", label: "3. AI Data Processing" },
  { id: "storage-security", label: "4. Storage & Security" },
  { id: "third-party", label: "5. Third-Party Services" },
  { id: "data-sharing", label: "6. Data Sharing" },
  { id: "cookies", label: "7. Cookies & Tracking" },
  { id: "retention", label: "8. Retention & Deletion" },
  { id: "your-rights", label: "9. Your Rights" },
  { id: "international", label: "10. International Transfers" },
  { id: "disclaimer", label: "11. Disclaimer" },
  { id: "children", label: "12. Children's Privacy" },
  { id: "changes", label: "13. Changes" },
  { id: "contact", label: "14. Contact Us" },
];

export default async function PrivacyPolicyPage() {
  const t = await getTranslations("privacy");

  return (
    <div className="marketing-edu relative min-h-[100dvh] overflow-hidden">
      <div className="edu-bg" aria-hidden="true" />

      <div className="relative z-[2] mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 lg:max-w-5xl lg:px-8">
        {/* Nav */}
        <nav className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-slate-800 transition-colors hover:text-slate-900"
          >
            <Search className="h-4 w-4 text-emerald-700" />
            Joblit
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        </nav>

        {/* Header */}
        <header className="legal-header">
          <div className="legal-header-badge">
            <Shield className="h-3.5 w-3.5" />
            Privacy
          </div>
          <h1 className="legal-title">{t("title")}</h1>
          <div className="legal-meta">
            <span>Last updated: {t("lastUpdated")}</span>
            <span className="legal-meta-sep" aria-hidden="true" />
            <span>Joblit</span>
          </div>
        </header>

        {/* Grid: content + sidebar TOC */}
        <div className="legal-page">
          <main>
            {/* Mobile TOC — only renders the collapsible toggle (hidden at lg+) */}
            <LegalTableOfContents items={TOC_ITEMS} variant="mobile" />

            {/* Intro */}
            <div className="legal-body py-4">
              <p>{t("intro")}</p>
            </div>

            {/* Section 1 */}
            <section id="info-collect" className="legal-section">
              <h2 className="legal-section-title">{t("s1Title")}</h2>
              <div className="legal-body">
                <h3 className="legal-section-subtitle">{t("s1_1Title")}</h3>
                <p>{t("s1_1")}</p>

                <h3 className="legal-section-subtitle">{t("s1_2Title")}</h3>
                <p>{t("s1_2")}</p>

                <h3 className="legal-section-subtitle">{t("s1_3Title")}</h3>
                <p>{t("s1_3")}</p>

                <h3 className="legal-section-subtitle">{t("s1_4Title")}</h3>
                <p>{t("s1_4")}</p>

                <h3 className="legal-section-subtitle">{t("s1_5Title")}</h3>
                <p>{t("s1_5")}</p>
              </div>
            </section>

            {/* Section 2 */}
            <section id="how-use" className="legal-section">
              <h2 className="legal-section-title">{t("s2Title")}</h2>
              <div className="legal-body">
                <p>{t("s2")}</p>
              </div>
            </section>

            {/* Section 3 */}
            <section id="ai-processing" className="legal-section">
              <h2 className="legal-section-title">{t("s3Title")}</h2>
              <div className="legal-body">
                <p>{t("s3")}</p>
              </div>
            </section>

            {/* Section 4 */}
            <section id="storage-security" className="legal-section">
              <h2 className="legal-section-title">{t("s4Title")}</h2>
              <div className="legal-body">
                <p>{t("s4")}</p>
              </div>
            </section>

            {/* Section 5 */}
            <section id="third-party" className="legal-section">
              <h2 className="legal-section-title">{t("s5Title")}</h2>
              <div className="legal-body">
                <p>{t("s5Intro")}</p>
                <ul>
                  <li>{t("s5Google")}</li>
                  <li>{t("s5Github")}</li>
                  <li>{t("s5Vercel")}</li>
                  <li>{t("s5Neon")}</li>
                  <li>{t("s5Gemini")}</li>
                  <li>{t("s5Latex")}</li>
                </ul>
                <p>{t("s5Note")}</p>
              </div>
            </section>

            {/* Section 6 */}
            <section id="data-sharing" className="legal-section">
              <h2 className="legal-section-title">{t("s6Title")}</h2>
              <div className="legal-body">
                <p>{t("s6")}</p>
              </div>
            </section>

            {/* Section 7 */}
            <section id="cookies" className="legal-section">
              <h2 className="legal-section-title">{t("s7Title")}</h2>
              <div className="legal-body">
                <p>{t("s7")}</p>
              </div>
            </section>

            {/* Section 8 */}
            <section id="retention" className="legal-section">
              <h2 className="legal-section-title">{t("s8Title")}</h2>
              <div className="legal-body">
                <p>{t("s8")}</p>
              </div>
            </section>

            {/* Section 9 */}
            <section id="your-rights" className="legal-section">
              <h2 className="legal-section-title">{t("s9Title")}</h2>
              <div className="legal-body">
                <p>{t("s9Intro")}</p>
                <ul>
                  <li>{t("s9Gdpr")}</li>
                  <li>{t("s9Ccpa")}</li>
                  <li>{t("s9Aus")}</li>
                </ul>
                <p>{t("s9Exercise")}</p>
              </div>
            </section>

            {/* Section 10 */}
            <section id="international" className="legal-section">
              <h2 className="legal-section-title">{t("s10Title")}</h2>
              <div className="legal-body">
                <p>{t("s10")}</p>
              </div>
            </section>

            {/* Section 11 */}
            <section id="disclaimer" className="legal-section">
              <h2 className="legal-section-title">{t("s11Title")}</h2>
              <div className="legal-body">
                <p>{t("s11Intro")}</p>
                <ul>
                  <li>{t("s11_1")}</li>
                  <li>{t("s11_2")}</li>
                  <li>{t("s11_3")}</li>
                  <li>{t("s11_4")}</li>
                  <li>{t("s11_5")}</li>
                  <li>{t("s11_6")}</li>
                </ul>
              </div>
            </section>

            {/* Section 12 */}
            <section id="children" className="legal-section">
              <h2 className="legal-section-title">{t("s12Title")}</h2>
              <div className="legal-body">
                <p>{t("s12")}</p>
              </div>
            </section>

            {/* Section 13 */}
            <section id="changes" className="legal-section">
              <h2 className="legal-section-title">{t("s13Title")}</h2>
              <div className="legal-body">
                <p>{t("s13")}</p>
              </div>
            </section>

            {/* Section 14 */}
            <section id="contact" className="legal-section">
              <h2 className="legal-section-title">{t("s14Title")}</h2>
              <div className="legal-body">
                <p>{t("s14")}</p>
                <p>
                  <strong>Email:</strong>{" "}
                  <a href={`mailto:${t("s14Email")}`}>{t("s14Email")}</a>
                </p>
              </div>
            </section>

            {/* Cross-link to Terms */}
            <Link href="/terms" className="legal-cross-link">
              <ArrowRight className="h-4 w-4" />
              <span>
                Also see our <strong>Terms of Service</strong> for the rules that
                govern your use of Joblit.
              </span>
            </Link>
          </main>

          {/* Desktop sidebar — only renders the sticky nav (hidden below lg) */}
          <aside>
            <LegalTableOfContents items={TOC_ITEMS} variant="desktop" />
          </aside>
        </div>

        {/* Footer */}
        <footer className="legal-footer">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/" className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Search className="h-3.5 w-3.5 text-emerald-700" />
              Joblit
            </Link>
            <span aria-hidden="true">&middot;</span>
            <span className="font-medium text-emerald-700">Privacy</span>
            <span aria-hidden="true">&middot;</span>
            <Link href="/terms" className="transition-colors hover:text-slate-600">Terms</Link>
            <span aria-hidden="true">&middot;</span>
            <span>&copy; {new Date().getFullYear()} All rights reserved.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
