"use client";

import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  GitBranch,
  Github,
  ListFilter,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { useCtaHref } from "./lib/useCtaHref";
import styles from "./ProductSections.module.css";

const REPO_URL = "https://github.com/ShousenZHANG/joblit";
const SETUP_URL = `${REPO_URL}/blob/master/docs/adr/0024-generate-from-a-local-sidecar.md`;

export function ProductSections() {
  const t = useTranslations("landingExperience");
  const useSerifAccent = !useLocale().startsWith("zh");
  const cta = useCtaHref();

  return (
    <div className={styles.root}>
      <section id="features" className={styles.features} aria-labelledby="features-title">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>{t("features.eyebrow")}</p>
          <h2 id="features-title" className={styles.sectionTitle}><EditorialTitle text={t("features.title")} accented={useSerifAccent} /></h2>
          <p className={styles.introDescription}>{t("features.description")}</p>
        </div>

        <div className={styles.featureSpread}>
          <div className={styles.featureCopy}>
            <FeatureText number="01" title={t("features.discoveryTitle")} description={t("features.discoveryDescription")} />
            <FeatureText number="02" title={t("features.requirementsTitle")} description={t("features.requirementsDescription")} />
          </div>
          <figure className={styles.opportunityFigure}>
            <div className={styles.figureTopline}>
              <span className={styles.figureIcon}><ListFilter size={16} aria-hidden="true" /></span>
              <span>{t("features.workspaceTitle")}</span>
            </div>
            <div className={styles.opportunityWindow}>
              <div className={styles.windowHeader}>
                <span className={styles.statusPill}><span />{t("features.newStatus")}</span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </div>
              <p className={styles.roleTitle}>{t("features.roleTitle")}</p>
              <p className={styles.roleMeta}><MapPin size={14} aria-hidden="true" />{t("features.roleMeta")}</p>
              <div className={styles.requirementRow}>
                <span>{t("features.experienceLabel")}</span>
                <strong>{t("features.experienceValue")}</strong>
              </div>
              <div className={styles.sourceQuote}>
                <span className={styles.sourceLabel}><ArrowDownRight size={15} aria-hidden="true" />{t("features.sourceLabel")}</span>
                <blockquote>{t("features.sourceQuote")}</blockquote>
              </div>
            </div>
            <figcaption className={styles.figureCaption}>{t("features.previewLabel")}</figcaption>
          </figure>
        </div>

        <div className={`${styles.featureSpread} ${styles.documentSpread}`}>
          <figure className={styles.documentFigure}>
            <div className={styles.documentGhost} aria-hidden="true" />
            <div className={styles.resumePaper}>
              <div className={styles.paperLabel}>{t("features.resumeLabel")}<FileText size={15} aria-hidden="true" /></div>
              <p className={styles.resumeName}>{t("features.resumeName")}</p>
              <p className={styles.resumeRole}>{t("features.resumeRole")}</p>
              <span className={styles.paperRule} />
              <p className={styles.paperSectionTitle}>{t("features.summaryLabel")}</p>
              <p className={styles.paperSummary}>{t("features.summaryText")}</p>
              <p className={styles.paperSectionTitle}>{t("features.skillsLabel")}</p>
              <div className={styles.paperSkills}><span>React</span><span>TypeScript</span><span>Azure</span></div>
              <div className={styles.preserved}><ShieldCheck size={15} aria-hidden="true" />{t("features.experienceUnchanged")}</div>
            </div>
            <div className={styles.documentChip}><FileText size={18} aria-hidden="true" /><span>{t("features.documentReady")}</span><span className={styles.pdfBadge}>{t("features.pdfBadge")}</span></div>
            <figcaption className={styles.figureCaption}>{t("features.previewLabel")}</figcaption>
          </figure>
          <div className={styles.featureCopy}>
            <FeatureText number="03" title={t("features.tailoringTitle")} description={t("features.tailoringDescription")} />
            <FeatureText number="04" title={t("features.pdfTitle")} description={t("features.pdfDescription")} />
          </div>
        </div>

        <div className={styles.supportingFeatures}>
          <div className={styles.supportingFeature}>
            <FeatureText number="05" title={t("features.versionsTitle")} description={t("features.versionsDescription")} />
            <div className={styles.versionsPreview}>
              <div className={styles.versionMeta}><GitBranch size={16} aria-hidden="true" />{t("features.versionLabel")}</div>
              <div className={styles.versionRow}><span className={styles.versionDot} /><span>{t("features.versionGeneral")}</span></div>
              <div className={styles.versionRow}><span className={styles.versionBranch} /><span>{t("features.versionEngineering")}</span><Check size={14} aria-hidden="true" /></div>
              <p className={styles.autosave}><Check size={13} aria-hidden="true" />{t("features.autosaved")}</p>
            </div>
          </div>
          <div className={styles.supportingFeature}>
            <FeatureText number="06" title={t("features.trackingTitle")} description={t("features.trackingDescription")} />
            <div className={styles.trackingPreview}>
              <span className={styles.trackingLabel}>{t("features.trackingLabel")}</span>
              <div className={styles.trackingStates}>
                <span className={styles.stateNew}><span />{t("features.newStatus")}</span>
                <ArrowRight size={14} aria-hidden="true" />
                <span className={styles.stateApplied}><Check size={12} aria-hidden="true" />{t("features.appliedStatus")}</span>
                <span className={styles.stateRejected}>{t("features.rejectedStatus")}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="get-started" className={styles.gettingStarted} aria-labelledby="get-started-title">
        <div className={styles.setupIntro}>
          <p className={styles.eyebrow}>{t("gettingStarted.eyebrow")}</p>
          <h2 id="get-started-title" className={styles.sectionTitle}><EditorialTitle text={t("gettingStarted.title")} accented={useSerifAccent} /></h2>
          <p className={styles.introDescription}>{t("gettingStarted.description")}</p>
        </div>
        <ol className={styles.setupSteps}>
          {[1, 2, 3].map((step) => (
            <li key={step}>
              <span className={styles.setupNumber}>0{step}</span>
              <div>
                <h3>{t(`gettingStarted.step${step}Title`)}</h3>
                <p>{t(`gettingStarted.step${step}Description`)}</p>
                {step === 3 && <a href={SETUP_URL} target="_blank" rel="noopener noreferrer" className={styles.textLink}>{t("gettingStarted.setupLink")}<ArrowUpRight size={15} aria-hidden="true" /></a>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="faq" className={styles.faq} aria-labelledby="faq-title">
        <div>
          <p className={styles.eyebrow}>{t("faq.eyebrow")}</p>
          <h2 id="faq-title" className={styles.faqTitle}>{t("faq.title")}</h2>
        </div>
        <div className={styles.faqItems}>
          {[0, 1, 2, 3].map((index) => (
            <details key={index} className={styles.faqItem}>
              <summary>{t(`faq.items.${index}.question`)}<ChevronDown size={19} aria-hidden="true" /></summary>
              <p>{t(`faq.items.${index}.answer`)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.finalCta} aria-labelledby="final-cta-title">
        <div className={styles.ctaEmblem} aria-hidden="true"><JoblitMark size={40} color="currentColor" ariaLabel={null} /></div>
        <p className={styles.eyebrow}>{t("finalCta.eyebrow")}</p>
        <h2 id="final-cta-title" className={styles.ctaTitle}><EditorialTitle text={t("finalCta.title")} accented={useSerifAccent} /></h2>
        <p className={styles.ctaDescription}>{t("finalCta.description")}</p>
        <div className={styles.ctaActions}>
          <Link href={cta.href} prefetch={cta.prefetch} className={styles.primaryButton}>{t("finalCta.primary")}<ArrowRight size={17} aria-hidden="true" /></Link>
          <a href="#demo" className={styles.secondaryButton}>{t("finalCta.secondary")}<ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrand}>
            <Link href="/" className={styles.wordmark} aria-label={t("nav.home")}><JoblitMark size={24} color="currentColor" ariaLabel={null} />Joblit<span className={styles.brandDot}>.</span></Link>
            <p>{t("footer.tagline")}</p>
          </div>
          <div className={styles.footerColumn}>
            <h3>{t("footer.product")}</h3>
            <Link href={cta.href} prefetch={cta.prefetch}>{t("footer.workspace")}</Link>
            <a href="#demo">{t("footer.demo")}</a>
            <a href={SETUP_URL} target="_blank" rel="noopener noreferrer">{t("footer.setup")}<ArrowUpRight size={13} aria-hidden="true" /></a>
          </div>
          <div className={styles.footerColumn}>
            <h3>{t("footer.project")}</h3>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer"><Github size={14} aria-hidden="true" />{t("footer.source")}</a>
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">{t("footer.issue")}</a>
          </div>
          <div className={styles.footerColumn}>
            <h3>{t("footer.legal")}</h3>
            <Link href="/privacy">{t("footer.privacy")}</Link>
            <Link href="/terms">{t("footer.terms")}</Link>
          </div>
        </div>
        <div className={styles.footerBottom}><span>{t("footer.copyright")}</span><span>{t("footer.note")}</span></div>
      </footer>
    </div>
  );
}

function EditorialTitle({ text, accented }: { text: string; accented: boolean }) {
  const [firstLine, ...remainingLines] = text.split("\n");
  if (!accented || remainingLines.length === 0) return text;
  return <>{firstLine}<br /><em className={styles.titleAccent}>{remainingLines.join(" ")}</em></>;
}

function FeatureText({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className={styles.featureText}>
      <span className={styles.featureNumber}>{number}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
