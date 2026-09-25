import type { CSSProperties, ReactNode } from "react";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEMO_JOBS, DEMO_PROFILE, DEMO_SKILLS } from "./ApplicationDemo.data";
import base from "./Landing.module.css";
import styles from "./GroundingProof.module.css";

// The same fixture the interactive demo and its sample PDFs use, so the
// figure shows the product's real rule rather than an illustration of it:
// the model's answer is a list of positions in the candidate's own skills.
const job = DEMO_JOBS[0];
const picks: readonly number[] = job.skills;
const technologies: readonly string[] = job.technology;
const chosenSkills = picks.map(index => DEMO_SKILLS[index]);
const picksText = `[${picks.join(", ")}]`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sequence = (order: number) => ({ "--order": order }) as CSSProperties;

/** Mark each technology the job ad names, in the order it appears. */
function markTechnologies(text: string): ReactNode[] {
  const pattern = new RegExp(`(${technologies.map(escapeRegExp).join("|")})`, "g");
  let order = 0;
  return text.split(pattern).map((part, index) =>
    technologies.includes(part)
      ? <mark key={index} className={styles.mark} style={sequence(order++)}>{part}</mark>
      : part,
  );
}

export function GroundingProof() {
  const t = useTranslations("landingExperience.proof");
  const city = job.location.split(",")[0];

  return (
    <figure className={styles.proof} aria-label={t("label")}>
      <div className={styles.step}>
        <p className={styles.label}>{t("jobAd")}</p>
        <div className={styles.ad}>
          <p className={styles.role}>{job.title}</p>
          <p className={styles.company}>{job.company}, {city}</p>
          <blockquote className={styles.quote}>{markTechnologies(job.source)}</blockquote>
          <ul className={styles.technologies} aria-label={t("technologies")}>
            {technologies.map(technology => <li key={technology}>{technology}</li>)}
          </ul>
        </div>
      </div>

      <div className={styles.step} data-hinge="">
        <p className={styles.label}>{t("modelPicks")}</p>
        <div className={styles.picks}>
          <code className={styles.picksValue} style={{ "--chars": picksText.length } as CSSProperties}>{picksText}</code>
          <span className={styles.picksNote}>{t("modelNote")}</span>
        </div>
      </div>

      <div className={styles.step}>
        <p className={styles.label}>{t("yourSkills")}</p>
        <ol className={styles.skills}>
          {DEMO_SKILLS.map((skill, index) => {
            const order = picks.indexOf(index);
            const picked = order >= 0;
            return (
              <li key={skill} className={styles.skill} data-picked={picked ? "" : undefined} style={picked ? sequence(order) : undefined}>
                <span className={styles.index}>{index}</span>
                {skill}
                {picked && <span className={base.srOnly}>, {t("selected")}</span>}
              </li>
            );
          })}
        </ol>
      </div>

      <div className={styles.step}>
        <p className={styles.label}>{t("resume")}</p>
        <div className={styles.document}>
          <p className={styles.name}>{DEMO_PROFILE.name}</p>
          <p className={styles.documentRole}>{DEMO_PROFILE.title}</p>
          <dl className={styles.documentRows}>
            <div>
              <dt>{t("resumeSkills")}</dt>
              <dd className={styles.chosen}>{chosenSkills.join(", ")}</dd>
            </div>
            <div>
              <dt>{t("resumeExperience")}</dt>
              <dd className={styles.kept}><Lock size={13} aria-hidden="true" />{t("experienceKept")}</dd>
            </div>
          </dl>
        </div>
      </div>

      <figcaption className={styles.caption}>{t("example")}</figcaption>
    </figure>
  );
}
