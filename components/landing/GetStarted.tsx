import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { SETUP_URL } from "./links";
import base from "./Landing.module.css";
import styles from "./GetStarted.module.css";

const STEPS = ["step1", "step2", "step3"] as const;

export function GetStarted() {
  const t = useTranslations("landingExperience.gettingStarted");
  return (
    <section id="get-started" className={base.section} aria-labelledby="get-started-title">
      <div className={base.container}>
        <header className={base.sectionHead}>
          <h2 id="get-started-title" className={base.h2}>{t("title")}</h2>
          <p className={base.lead}>{t("description")}</p>
        </header>
        <ol className={styles.steps}>
          {STEPS.map((step, index) => (
            <li key={step} className={styles.step}>
              <span className={styles.number}>{index + 1}</span>
              <h3 className={styles.title}>{t(`${step}Title`)}</h3>
              <p className={styles.text}>{t(`${step}Description`)}</p>
              {step === "step3" && (
                <a href={SETUP_URL} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  {t("setupLink")}<ArrowUpRight size={15} aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ol>
        <p className={styles.note}><ShieldCheck size={17} aria-hidden="true" />{t("note")}</p>
      </div>
    </section>
  );
}
