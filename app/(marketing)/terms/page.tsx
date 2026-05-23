import type { Metadata } from "next";
import Link from "next/link";
import { Search, ArrowLeft, ArrowRight, FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import LegalTableOfContents from "../LegalTableOfContents";

export const metadata: Metadata = {
  title: "Terms of Service — Joblit",
  description: "Terms governing use of the Joblit application.",
};

const TOC_ITEMS = [
  { id: "acceptance", label: "1. Acceptance of Terms" },
  { id: "description", label: "2. Description of Service" },
  { id: "account", label: "3. Account & Security" },
  { id: "acceptable-use", label: "4. Acceptable Use" },
  { id: "ip", label: "5. Intellectual Property" },
  { id: "ai-disclaimer", label: "6. AI Content Disclaimer" },
  { id: "third-party-data", label: "7. Third-Party Data" },
  { id: "liability", label: "8. Limitation of Liability" },
  { id: "indemnification", label: "9. Indemnification" },
  { id: "termination", label: "10. Termination" },
  { id: "governing-law", label: "11. Governing Law" },
  { id: "general", label: "12. General Provisions" },
  { id: "contact", label: "13. Contact Us" },
];

export default async function TermsOfServicePage() {
  const t = await getTranslations("terms");

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
            <FileText className="h-3.5 w-3.5" />
            Terms
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
            <section id="acceptance" className="legal-section">
              <h2 className="legal-section-title">{t("s1Title")}</h2>
              <div className="legal-body">
                <p>{t("s1")}</p>
              </div>
            </section>

            {/* Section 2 */}
            <section id="description" className="legal-section">
              <h2 className="legal-section-title">{t("s2Title")}</h2>
              <div className="legal-body">
                <p>{t("s2")}</p>
              </div>
            </section>

            {/* Section 3 */}
            <section id="account" className="legal-section">
              <h2 className="legal-section-title">{t("s3Title")}</h2>
              <div className="legal-body">
                <p>{t("s3")}</p>
              </div>
            </section>

            {/* Section 4 */}
            <section id="acceptable-use" className="legal-section">
              <h2 className="legal-section-title">{t("s4Title")}</h2>
              <div className="legal-body">
                <p>{t("s4Intro")}</p>
                <ul>
                  <li>{t("s4_1")}</li>
                  <li>{t("s4_2")}</li>
                  <li>{t("s4_3")}</li>
                  <li>{t("s4_4")}</li>
                  <li>{t("s4_5")}</li>
                  <li>{t("s4_6")}</li>
                  <li>{t("s4_7")}</li>
                  <li>{t("s4_8")}</li>
                </ul>
              </div>
            </section>

            {/* Section 5 */}
            <section id="ip" className="legal-section">
              <h2 className="legal-section-title">{t("s5Title")}</h2>
              <div className="legal-body">
                <p>{t("s5_1")}</p>
                <p>{t("s5_2")}</p>
                <p>{t("s5_3")}</p>
                <p>{t("s5_4")}</p>
              </div>
            </section>

            {/* Section 6 */}
            <section id="ai-disclaimer" className="legal-section">
              <h2 className="legal-section-title">{t("s6Title")}</h2>
              <div className="legal-body">
                <p>{t("s6")}</p>
              </div>
            </section>

            {/* Section 7 */}
            <section id="third-party-data" className="legal-section">
              <h2 className="legal-section-title">{t("s7Title")}</h2>
              <div className="legal-body">
                <p>{t("s7")}</p>
              </div>
            </section>

            {/* Section 8 */}
            <section id="liability" className="legal-section">
              <h2 className="legal-section-title">{t("s8Title")}</h2>
              <div className="legal-body legal-caps">
                <p>{t("s8")}</p>
              </div>
            </section>

            {/* Section 9 */}
            <section id="indemnification" className="legal-section">
              <h2 className="legal-section-title">{t("s9Title")}</h2>
              <div className="legal-body">
                <p>{t("s9")}</p>
              </div>
            </section>

            {/* Section 10 */}
            <section id="termination" className="legal-section">
              <h2 className="legal-section-title">{t("s10Title")}</h2>
              <div className="legal-body">
                <p>{t("s10")}</p>
              </div>
            </section>

            {/* Section 11 */}
            <section id="governing-law" className="legal-section">
              <h2 className="legal-section-title">{t("s11Title")}</h2>
              <div className="legal-body">
                <p>{t("s11")}</p>
              </div>
            </section>

            {/* Section 12 */}
            <section id="general" className="legal-section">
              <h2 className="legal-section-title">{t("s12Title")}</h2>
              <div className="legal-body">
                <ul>
                  <li>{t("s12_1")}</li>
                  <li>{t("s12_2")}</li>
                  <li>{t("s12_3")}</li>
                  <li>{t("s12_4")}</li>
                  <li>{t("s12_5")}</li>
                </ul>
              </div>
            </section>

            {/* Section 13 */}
            <section id="contact" className="legal-section">
              <h2 className="legal-section-title">{t("s13Title")}</h2>
              <div className="legal-body">
                <p>{t("s13")}</p>
                <p>
                  <strong>Email:</strong>{" "}
                  <a href={`mailto:${t("s13Email")}`}>{t("s13Email")}</a>
                </p>
              </div>
            </section>

            {/* Cross-link to Privacy */}
            <Link href="/privacy" className="legal-cross-link">
              <ArrowRight className="h-4 w-4" />
              <span>
                Also see our <strong>Privacy Policy</strong> to understand how we
                handle your data.
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
            <Link href="/privacy" className="transition-colors hover:text-slate-600">Privacy</Link>
            <span aria-hidden="true">&middot;</span>
            <span className="font-medium text-emerald-700">Terms</span>
            <span aria-hidden="true">&middot;</span>
            <span>&copy; {new Date().getFullYear()} All rights reserved.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
