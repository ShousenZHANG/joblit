"use client";

import { useId } from "react";
import { Check, ChevronDown, FileText, ScanText } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "./WorkflowStory.module.css";

type StoryStep = { label: string; title: string; description: string };

export function WorkflowStory({ activeStep, onStepChange }: {
  activeStep: number;
  onStepChange: (index: number) => void;
}) {
  const t = useTranslations("landingExperience.story");
  const id = useId();
  const steps = t.raw("steps") as StoryStep[];

  return (
    <div className={styles.story}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className={styles.description}>{t("description")}</p>
      </div>
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const active = activeStep === index;
          const buttonId = `${id}-step-${index}`;
          const panelId = `${id}-panel-${index}`;
          return (
            <li key={step.label} className={styles.step} data-active={active}>
              <h3 className={styles.stepHeading}>
                <button
                  id={buttonId}
                  type="button"
                  className={styles.stepButton}
                  aria-expanded={active}
                  aria-controls={panelId}
                  onClick={() => onStepChange(index)}
                >
                  <span className={styles.number}>0{index + 1}</span>
                  <span className={styles.stepCopy}>
                    <span className={styles.label}>{step.label.replace(/^\d+\s*\/\s*/u, "")}</span>
                    <span className={styles.title}>{step.title}</span>
                  </span>
                  <ChevronDown size={17} className={styles.chevron} aria-hidden="true" />
                </button>
              </h3>
              <div id={panelId} role="region" aria-labelledby={buttonId} className={styles.panel} hidden={!active}>
                <p className={styles.stepDescription}>{step.description}</p>
                {index === 0 && (
                  <div className={styles.experienceResult}>
                    <span><ScanText size={15} aria-hidden="true" />{t("requiredExperience")}</span>
                    <strong>{t("experienceExample")}</strong>
                  </div>
                )}
                {index === 1 && (
                  <div className={styles.skillsResult}>
                    <span className={styles.resultLabel}>{t("existingSkills")}</span>
                    <div className={styles.skills}><span className={styles.emphasized}><Check size={12} aria-hidden="true" />React</span><span className={styles.emphasized}><Check size={12} aria-hidden="true" />TypeScript</span><span>SQL</span></div>
                  </div>
                )}
                {index === 2 && (
                  <div className={styles.documentsResult}>
                    <span className={styles.resultLabel}>{t("documents")}</span>
                    <div className={styles.documents}><span><FileText size={15} aria-hidden="true" />Resume.pdf</span><span><FileText size={15} aria-hidden="true" />CoverLetter.pdf</span></div>
                  </div>
                )}
                <p className={styles.illustrative}>{t("illustrative")}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
