import { useTranslations } from "next-intl";
import { CtaLink } from "./CtaLink";
import { GroundingProof } from "./GroundingProof";
import base from "./Landing.module.css";
import styles from "./Hero.module.css";

export function Hero() {
  const t = useTranslations("landingExperience.hero");
  return (
    <section id="overview" className={styles.hero} aria-labelledby="landing-title">
      <div className={`${base.container} ${styles.grid}`}>
        <div className={styles.copy}>
          {/* One sentence per line: the claim reads as a pair, never split mid-thought. */}
          <h1 id="landing-title" className={styles.title}>
            <span className={styles.line}>{t("titleLead")}</span>{" "}
            <span className={styles.line}>{t("titleClaim")}</span>
          </h1>
          <p className={styles.description}>{t("description")}</p>
          <div className={`${base.actions} ${styles.actions}`}>
            <CtaLink className={base.buttonPrimary} />
            <a href="#demo" className={base.buttonSecondary}>{t("secondary")}</a>
          </div>
          <p className={styles.note}>{t("note")}</p>
        </div>
        <GroundingProof />
      </div>
    </section>
  );
}
