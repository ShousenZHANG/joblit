import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import base from "./Landing.module.css";
import styles from "./Faq.module.css";

type Item = { question: string; answer: string };

export function Faq() {
  const t = useTranslations("landingExperience.faq");
  const items = t.raw("items") as Item[];
  return (
    <section id="faq" className={base.section} aria-labelledby="faq-title">
      <div className={`${base.container} ${styles.layout}`}>
        <h2 id="faq-title" className={base.h2}>{t("title")}</h2>
        <div className={styles.items}>
          {items.map(item => (
            <details key={item.question} className={styles.item}>
              <summary className={styles.question}>{item.question}<Plus size={20} aria-hidden="true" /></summary>
              <p className={styles.answer}>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
