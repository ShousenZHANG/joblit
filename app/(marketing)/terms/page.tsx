import type { Metadata } from "next";
import Link from "next/link";
import { Search, ArrowLeft, ArrowRight, FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import LegalTableOfContents from "../LegalTableOfContents";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("terms");
  return {
    title: t("title"),
    description: t("intro"),
  };
}

const TOC_ITEMS = [
  { id: "acceptance", labelKey: "s1Title" },
  { id: "description", labelKey: "s2Title" },
  { id: "account", labelKey: "s3Title" },
  { id: "acceptable-use", labelKey: "s4Title" },
  { id: "ip", labelKey: "s5Title" },
  { id: "ai-disclaimer", labelKey: "s6Title" },
  { id: "third-party-data", labelKey: "s7Title" },
  { id: "liability", labelKey: "s8Title" },
  { id: "indemnification", labelKey: "s9Title" },
  { id: "termination", labelKey: "s10Title" },
  { id: "governing-law", labelKey: "s11Title" },
  { id: "general", labelKey: "s12Title" },
  { id: "warranty", labelKey: "sWarrantyTitle" },
  { id: "changes", labelKey: "sChangesTitle" },
  { id: "contact", labelKey: "s13Title" },
] as const;

export default async function TermsOfServicePage() {
  const t = await getTranslations("terms");
  const tm = await getTranslations("marketing");
  const tl = await getTranslations("legal");
  const tocItems = TOC_ITEMS.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
  }));
  const tocLabels = {
    aria: tl("tocAria"),
    heading: tl("tocHeading"),
    toggle: tl("tocToggle"),
  };

  return (
    <div className="marketing-edu relative min-h-[100dvh] overflow-hidden">
      <div className="edu-bg" aria-hidden="true" />

      <div className="relative z-[2] mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 lg:max-w-5xl lg:px-8">
        {/* Nav */}
        <nav className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-foreground transition-colors hover:text-brand-emerald-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Search className="h-4 w-4 text-brand-emerald-text" />
            Joblit
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {tl("back")}
          </Link>
        </nav>

        {/* Header */}
        <header className="legal-header">
          <div className="legal-header-badge">
            <FileText className="h-3.5 w-3.5" />
            {tm("terms")}
          </div>
          <h1 className="legal-title">{t("title")}</h1>
          <div className="legal-meta">
            <span>{tl("lastUpdated")}: {t("lastUpdated")}</span>
            <span className="legal-meta-sep" aria-hidden="true" />
            <span>Joblit</span>
          </div>
        </header>

        {/* Grid: content + sidebar TOC */}
        <div className="legal-page">
          <main id="main-content" tabIndex={-1}>
            {/* Mobile TOC — only renders the collapsible toggle (hidden at lg+) */}
            <LegalTableOfContents items={tocItems} variant="mobile" labels={tocLabels} />

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

            {/* Section 13 — Disclaimer of Warranties (conspicuous, all-caps) */}
            <section id="warranty" className="legal-section">
              <h2 className="legal-section-title">{t("sWarrantyTitle")}</h2>
              <div className="legal-body legal-caps">
                <p>{t("sWarranty")}</p>
              </div>
            </section>

            {/* Section 14 — Changes to Terms */}
            <section id="changes" className="legal-section">
              <h2 className="legal-section-title">{t("sChangesTitle")}</h2>
              <div className="legal-body">
                <p>{t("sChanges")}</p>
              </div>
            </section>

            {/* Section 15 */}
            <section id="contact" className="legal-section">
              <h2 className="legal-section-title">{t("s13Title")}</h2>
              <div className="legal-body">
                <p>{t("s13")}</p>
                <p>
                  <strong>{tl("email")}:</strong>{" "}
                  <a href={`mailto:${t("s13Email")}`}>{t("s13Email")}</a>
                </p>
              </div>
            </section>

            {/* Cross-link to Privacy */}
            <Link href="/privacy" className="legal-cross-link">
              <ArrowRight className="h-4 w-4" />
              <span>{tl("termsCrossLink")}</span>
            </Link>
          </main>

          {/* Desktop sidebar — only renders the sticky nav (hidden below lg) */}
          <aside>
            <LegalTableOfContents items={tocItems} variant="desktop" labels={tocLabels} />
          </aside>
        </div>

        {/* Footer */}
        <footer className="legal-footer">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 rounded-md font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <Search className="h-3.5 w-3.5 text-brand-emerald-text" />
              Joblit
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link href="/privacy" className="inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background">{tm("privacy")}</Link>
            <span aria-hidden="true">&middot;</span>
            <span className="font-medium text-brand-emerald-text">{tm("terms")}</span>
            <span aria-hidden="true">&middot;</span>
            <span>&copy; {new Date().getFullYear()} {tm("allRightsReserved")}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
