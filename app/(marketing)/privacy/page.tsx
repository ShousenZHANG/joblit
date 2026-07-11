import type { Metadata } from "next";
import Link from "next/link";
import { Search, ArrowLeft, ArrowRight, Shield } from "lucide-react";
import { getTranslations } from "next-intl/server";
import LegalTableOfContents from "../LegalTableOfContents";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return {
    title: t("title"),
    description: t("intro"),
  };
}

const TOC_ITEMS = [
  { id: "info-collect", labelKey: "s1Title" },
  { id: "how-use", labelKey: "s2Title" },
  { id: "ai-processing", labelKey: "s3Title" },
  { id: "storage-security", labelKey: "s4Title" },
  { id: "third-party", labelKey: "s5Title" },
  { id: "data-sharing", labelKey: "s6Title" },
  { id: "cookies", labelKey: "s7Title" },
  { id: "retention", labelKey: "s8Title" },
  { id: "your-rights", labelKey: "s9Title" },
  { id: "international", labelKey: "s10Title" },
  { id: "disclaimer", labelKey: "s11Title" },
  { id: "children", labelKey: "s12Title" },
  { id: "changes", labelKey: "s13Title" },
  { id: "contact", labelKey: "s14Title" },
] as const;

export default async function PrivacyPolicyPage() {
  const t = await getTranslations("privacy");
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
            <Shield className="h-3.5 w-3.5" />
            {tm("privacy")}
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
                  <strong>{tl("email")}:</strong>{" "}
                  <a href={`mailto:${t("s14Email")}`}>{t("s14Email")}</a>
                </p>
              </div>
            </section>

            {/* Cross-link to Terms */}
            <Link href="/terms" className="legal-cross-link">
              <ArrowRight className="h-4 w-4" />
              <span>{tl("privacyCrossLink")}</span>
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
            <span className="font-medium text-brand-emerald-text">{tm("privacy")}</span>
            <span aria-hidden="true">&middot;</span>
            <Link href="/terms" className="inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background">{tm("terms")}</Link>
            <span aria-hidden="true">&middot;</span>
            <span>&copy; {new Date().getFullYear()} {tm("allRightsReserved")}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
