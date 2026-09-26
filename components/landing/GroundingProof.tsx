"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAccessibleTabs } from "@/components/ui/useAccessibleTabs";
import { DEMO_JOBS, DEMO_PROFILE, DEMO_SKILLS, type DemoJob } from "./ApplicationDemo.data";
import base from "./Landing.module.css";
import styles from "./GroundingProof.module.css";

// The same fixtures the interactive demo and its sample PDFs use, so the
// figure shows the product's real rule rather than an illustration of it:
// the model's answer is a list of positions in the candidate's own skills.
const JOB_IDS = DEMO_JOBS.map(job => job.id);
type JobId = (typeof JOB_IDS)[number];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sequence = (order: number) => ({ "--order": order }) as CSSProperties;

/** Mark each technology the job ad names, in the order it appears. */
function markTechnologies(job: DemoJob): ReactNode[] {
  const technologies: readonly string[] = job.technology;
  const pattern = new RegExp(`(${technologies.map(escapeRegExp).join("|")})`, "g");
  let order = 0;
  return job.source.split(pattern).map((part, index) =>
    technologies.includes(part)
      ? <mark key={index} className={styles.mark} style={sequence(order++)}>{part}</mark>
      : part,
  );
}

export function GroundingProof() {
  const t = useTranslations("landingExperience.proof");
  const roleLabels = t.raw("roles") as Record<JobId, string>;
  const id = useId();
  const [activeId, setActiveId] = useState<JobId>(JOB_IDS[0]);
  // The first run is the page's opening sequence; a chosen role replays it quickly.
  const [replaying, setReplaying] = useState(false);
  const tabs = useAccessibleTabs<JobId>({
    id: `${id}-role`,
    value: activeId,
    values: JOB_IDS,
    onValueChange: next => {
      if (next === activeId) return;
      setActiveId(next);
      setReplaying(true);
    },
  });

  const job = DEMO_JOBS.find(item => item.id === activeId) ?? DEMO_JOBS[0];
  const picks: readonly number[] = job.skills;
  const picksText = `[${picks.join(", ")}]`;
  const chosenSkills = picks.map(index => DEMO_SKILLS[index]);
  const city = job.location.split(",")[0];

  // A soft light follows a mouse pointer across the ledger. One style write per
  // frame at most, and never for touch, where there is no hover to follow.
  const frame = useRef<number | null>(null);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const followPointer = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || frame.current !== null) return;
    const target = event.currentTarget;
    const { clientX, clientY } = event;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const bounds = target.getBoundingClientRect();
      target.style.setProperty("--spot-x", `${clientX - bounds.left}px`);
      target.style.setProperty("--spot-y", `${clientY - bounds.top}px`);
    });
  };

  return (
    <figure className={styles.proof} aria-label={t("label")} onPointerMove={followPointer}>
      <div className={styles.roles}>
        <span className={styles.rolesLabel}>{t("tryAnother")}</span>
        <div {...tabs.tabListProps} className={styles.roleTabs} aria-label={t("chooseRole")}>
          {JOB_IDS.map(jobId => (
            <button key={jobId} type="button" className={styles.roleTab} {...tabs.getTabProps(jobId)}>
              {roleLabels[jobId]}
            </button>
          ))}
        </div>
      </div>

      <div key={job.id} className={styles.chain} data-replay={replaying ? "" : undefined} {...tabs.getPanelProps(job.id)}>
        <span className={styles.pulse} aria-hidden="true" />

        <div className={styles.step}>
          <p className={styles.label}>{t("jobAd")}</p>
          <div className={styles.ad}>
            <p className={styles.role}>{job.title}</p>
            <p className={styles.company}>{job.company}, {city}</p>
            <blockquote className={styles.quote}>{markTechnologies(job)}</blockquote>
            <ul className={styles.technologies} aria-label={t("technologies")}>
              {job.technology.map(technology => <li key={technology}>{technology}</li>)}
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
      </div>

      <figcaption className={styles.caption}>{t("example")}</figcaption>
    </figure>
  );
}
