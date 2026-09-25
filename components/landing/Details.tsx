import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEMO_JOBS, DEMO_PROFILE } from "./ApplicationDemo.data";
import base from "./Landing.module.css";
import styles from "./Details.module.css";

const STATUSES = ["NEW", "APPLIED", "REJECTED"] as const;
const job = DEMO_JOBS[0];

/** The job ad's own words for the requirement, up to the end of that clause. */
function requirementEvidence() {
  const start = job.source.indexOf(job.requirement);
  if (start < 0) return { before: job.source, marked: "", after: "" };
  const end = job.source.indexOf(",", start);
  const stop = end < 0 ? job.source.length : end;
  return { before: job.source.slice(0, start), marked: job.source.slice(start, stop), after: job.source.slice(stop) };
}

export function Details() {
  const t = useTranslations("landingExperience.details");
  const status = useTranslations("landingExperience.demo.statuses");
  const evidence = requirementEvidence();

  return (
    <section id="details" className={base.section} aria-labelledby="details-title">
      <div className={base.container}>
        <header className={base.sectionHead}>
          <h2 id="details-title" className={base.h2}>{t("title")}</h2>
        </header>
        <div className={styles.grid}>
          <article className={styles.item}>
            <h3 className={styles.itemTitle}>{t("requirementsTitle")}</h3>
            <p className={styles.itemText}>{t("requirementsDescription")}</p>
            <div className={styles.visual} aria-hidden="true">
              <p className={styles.requirement}><span>{t("requirementLabel")}</span><strong>{job.requirement}</strong></p>
              <p className={styles.evidence}>{evidence.before}<mark>{evidence.marked}</mark>{evidence.after}</p>
            </div>
          </article>

          <article className={styles.item}>
            <h3 className={styles.itemTitle}>{t("statusTitle")}</h3>
            <p className={styles.itemText}>{t("statusDescription")}</p>
            <div className={`${styles.visual} ${styles.statuses}`} aria-hidden="true">
              {STATUSES.map(value => <span key={value} className={styles.status} data-status={value}>{status(value)}</span>)}
            </div>
          </article>

          <article className={styles.item}>
            <h3 className={styles.itemTitle}>{t("versionsTitle")}</h3>
            <p className={styles.itemText}>{t("versionsDescription")}</p>
            <div className={`${styles.visual} ${styles.versions}`} aria-hidden="true">
              <p className={styles.version}>{t("versionGeneral")}</p>
              <p className={styles.version} data-active="">{t("versionEngineering")}<Check size={14} /></p>
              <p className={styles.saved}><Check size={13} />{t("saved")}</p>
            </div>
          </article>

          <article className={styles.item}>
            <h3 className={styles.itemTitle}>{t("languagesTitle")}</h3>
            <p className={styles.itemText}>{t("languagesDescription")}</p>
            <div className={`${styles.visual} ${styles.pages}`} aria-hidden="true">
              {[t("languageEnglish"), t("languageChinese")].map(language => (
                <div key={language} className={styles.page}>
                  <p className={styles.pageName}>{DEMO_PROFILE.name}</p>
                  <span /><span /><span />
                  <p className={styles.pageLanguage}>{language}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
