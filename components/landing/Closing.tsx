import Link from "next/link";
import { ArrowUpRight, Github } from "lucide-react";
import { useTranslations } from "next-intl";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { CtaLink } from "./CtaLink";
import { REPO_URL, SETUP_URL } from "./links";
import base from "./Landing.module.css";
import styles from "./Closing.module.css";

export function Closing() {
  const t = useTranslations("landingExperience.closing");
  return (
    <section id="start" className={`${base.section} ${styles.closing}`} aria-labelledby="closing-title">
      <div className={base.container}>
        <h2 id="closing-title" className={styles.title}>{t("title")}</h2>
        <p className={`${base.lead} ${styles.description}`}>{t("description")}</p>
        <div className={`${base.actions} ${styles.actions}`}>
          <CtaLink className={base.buttonPrimary} />
          <a href="#demo" className={base.buttonSecondary}>{t("secondary")}</a>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  const t = useTranslations("landingExperience.footer");
  const nav = useTranslations("landingExperience.nav");
  return (
    <footer className={styles.footer}>
      <div className={`${base.container} ${styles.columns}`}>
        <div className={styles.brand}>
          <Link href="/" aria-label={nav("home")} className={styles.wordmark}>
            <span className={styles.mark}><JoblitMark size={22} color="currentColor" ariaLabel={null} /></span>Joblit
          </Link>
          <p className={styles.tagline}>{t("tagline")}</p>
        </div>
        <div className={styles.column}>
          <h3 className={styles.columnTitle}>{t("product")}</h3>
          <ul>
            <li><CtaLink>{t("workspace")}</CtaLink></li>
            <li><a href="#demo">{t("demo")}</a></li>
            <li><a href={SETUP_URL} target="_blank" rel="noopener noreferrer">{t("setup")}<ArrowUpRight size={13} aria-hidden="true" /></a></li>
          </ul>
        </div>
        <div className={styles.column}>
          <h3 className={styles.columnTitle}>{t("project")}</h3>
          <ul>
            <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer"><Github size={14} aria-hidden="true" />{t("source")}</a></li>
            <li><a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">{t("issue")}</a></li>
          </ul>
        </div>
        <div className={styles.column}>
          <h3 className={styles.columnTitle}>{t("legal")}</h3>
          <ul>
            <li><Link href="/privacy">{t("privacy")}</Link></li>
            <li><Link href="/terms">{t("terms")}</Link></li>
          </ul>
        </div>
      </div>
      <div className={`${base.container} ${styles.bottom}`}>{t("copyright")}</div>
    </footer>
  );
}
