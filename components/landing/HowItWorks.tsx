import { FileText, Lock, PencilLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEMO_JOBS } from "./ApplicationDemo.data";
import base from "./Landing.module.css";
import styles from "./HowItWorks.module.css";

type Step = { title: string; description: string };
const DOCUMENTS = ["Resume.pdf", "CoverLetter.pdf"] as const;

export function HowItWorks() {
  const t = useTranslations("landingExperience.howItWorks");
  const status = useTranslations("landingExperience.demo.statuses");
  const steps = t.raw("steps") as Step[];
  const visuals = [
    <div key="find" className={styles.visual}>
      {DEMO_JOBS.slice(0, 2).map((role, index) => (
        <div key={role.id} className={styles.role} data-selected={index === 0 ? "" : undefined}>
          <span className={styles.roleTitle}>{role.title}</span>
          <span className={styles.badge}>{status("NEW")}</span>
          <span className={styles.roleMeta}>{role.company}, {role.location.split(",")[0]}</span>
        </div>
      ))}
      <div className={styles.requirement}>
        <span>{t("requirement")}</span>
        <strong>{DEMO_JOBS[0].requirement}</strong>
        <span className={styles.source}>{t("showSource")}</span>
      </div>
    </div>,
    <div key="tailor" className={styles.visual}>
      <p className={styles.groupLabel}><PencilLine size={14} aria-hidden="true" />{t("changed")}</p>
      <p className={styles.item} data-kind="changed">{t("summary")}</p>
      <p className={styles.item} data-kind="changed">{t("skills")}</p>
      <p className={styles.groupLabel}><Lock size={14} aria-hidden="true" />{t("kept")}</p>
      <p className={styles.item} data-kind="kept">{t("experience")}</p>
      <p className={styles.item} data-kind="kept">{t("employers")}</p>
    </div>,
    <div key="send" className={styles.visual}>
      {DOCUMENTS.map(file => (
        <p key={file} className={styles.file}><FileText size={16} aria-hidden="true" />{file}<span className={styles.fileType}>PDF</span></p>
      ))}
      <p className={styles.status}><span className={styles.statusDot} />{status("APPLIED")}</p>
    </div>,
  ];

  return (
    <section id="how-it-works" className={base.section} aria-labelledby="how-it-works-title">
      <div className={base.container}>
        <header className={base.sectionHead}>
          <h2 id="how-it-works-title" className={base.h2}>{t("title")}</h2>
          <p className={base.lead}>{t("description")}</p>
        </header>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <div aria-hidden="true" className={styles.visualFrame}>{visuals[index]}</div>
              <h3 className={styles.title}><span className={styles.number}>{index + 1}</span>{step.title}</h3>
              <p className={styles.text}>{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
