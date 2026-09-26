import { AppWindow, ArrowLeftRight, ArrowUpDown, KeyRound, Laptop, Server, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import base from "./Landing.module.css";
import styles from "./YourModel.module.css";

export function YourModel() {
  const t = useTranslations("landingExperience.yourModel");
  return (
    <section id="your-model" className={base.section} aria-labelledby="your-model-title">
      <div className={base.container}>
        <header className={base.sectionHead}>
          <h2 id="your-model-title" className={base.h2}>{t("title")}</h2>
          <p className={base.lead}>{t("description")}</p>
        </header>
        {/* Source order follows the real topology so a single column stays
            truthful: the server connects only to the browser. */}
        <figure className={styles.diagram} aria-label={t("diagramLabel")}>
          <div className={`${styles.node} ${styles.server}`} style={{ gridArea: "server", "--i": 6 } as CSSProperties}>
            <div>
              <Server size={20} aria-hidden="true" className={styles.icon} />
              <p className={styles.nodeTitle}>{t("server")}</p>
              <p className={styles.nodeNote}>{t("serverNote")}</p>
            </div>
            <p className={styles.noKey}><ShieldCheck size={16} aria-hidden="true" />{t("noKey")}</p>
          </div>
          <div className={styles.vertical} style={{ gridArea: "drafts", "--i": 5 } as CSSProperties}>
            <ArrowUpDown size={18} aria-hidden="true" />
            <span>{t("drafts")}</span>
          </div>
          <div className={styles.node} style={{ gridArea: "browser", "--i": 0 } as CSSProperties}>
            <AppWindow size={20} aria-hidden="true" className={styles.icon} />
            <p className={styles.nodeTitle}>{t("browser")}</p>
            <p className={styles.nodeNote}>{t("browserNote")}</p>
          </div>
          <span className={styles.link} style={{ gridArea: "toHermes", "--i": 1 } as CSSProperties} aria-hidden="true"><ArrowLeftRight size={18} /></span>
          <div className={styles.node} style={{ gridArea: "hermes", "--i": 2 } as CSSProperties}>
            <Laptop size={20} aria-hidden="true" className={styles.icon} />
            <p className={styles.nodeTitle}>{t("hermes")}</p>
            <p className={styles.nodeNote}>{t("hermesNote")}</p>
          </div>
          <span className={styles.link} style={{ gridArea: "toAccount", "--i": 3 } as CSSProperties} aria-hidden="true"><ArrowLeftRight size={18} /></span>
          <div className={styles.node} style={{ gridArea: "account", "--i": 4 } as CSSProperties}>
            <KeyRound size={20} aria-hidden="true" className={styles.icon} />
            <p className={styles.nodeTitle}>{t("account")}</p>
            <p className={styles.nodeNote}>{t("accountNote")}</p>
          </div>
        </figure>
      </div>
    </section>
  );
}
