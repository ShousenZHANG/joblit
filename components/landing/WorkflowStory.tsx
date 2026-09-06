"use client";

import { useEffect, useId } from "react";
import { ArrowDown, ArrowRight, Check, FileText, ScanText } from "lucide-react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import type { MotionValue } from "framer-motion";
import { useTranslations } from "next-intl";
import styles from "./WorkflowStory.module.css";
import { useLandingMotionPaused } from "./lib/LandingMotion";

type StoryStep = { label: string; title: string; description: string };
type WorkflowStoryProps = {
  activeStep: number;
  onStepChange: (index: number) => void;
  progress?: MotionValue<number>;
  reducedMotion?: boolean;
  staticMode?: boolean;
};

function StoryChapter({ step, index, active, staticMode, id }: {
  step: StoryStep;
  index: number;
  active: boolean;
  staticMode: boolean;
  id: string;
}) {
  const t = useTranslations("landingExperience.story");
  const paused = useLandingMotionPaused();
  // A chapter change finishes independently of scrolling. Stopping between
  // scene poses must never leave two half-visible passages over each other.
  const visible = staticMode || active;
  const titleId = `${id}-chapter-title-${index}`;

  return (
    <motion.article
      key={staticMode ? "static" : "progressive"}
      id={`${id}-chapter-${index}`}
      data-workflow-chapter={index}
      className={styles.chapter}
      aria-labelledby={titleId}
      aria-hidden={staticMode ? undefined : !active}
      inert={!staticMode && !active}
      initial={false}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 14, rotateX: visible ? 0 : 3, scale: visible ? 1 : 0.985 }}
      transition={staticMode || paused ? { duration: 0 } : {
        duration: active ? 0.22 : 0.1,
        delay: active ? 0.1 : 0,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div className={styles.chapterMeta}>
        <span className={styles.chapterNumber} aria-hidden="true">0{index + 1}<span> / 03</span></span>
        <span className={styles.chapterLabel}>{step.label}</span>
      </div>
      <h3 id={titleId} className={styles.title}>{step.title}</h3>
      <p className={styles.stepDescription}>{step.description}</p>
      {index === 0 && (
        <div className={styles.experienceResult}>
          <span><ScanText size={17} aria-hidden="true" />{t("requiredExperience")}</span>
          <strong>{t("experienceExample")}</strong>
        </div>
      )}
      {index === 1 && (
        <div className={styles.skillsResult}>
          <span className={styles.resultLabel}>{t("existingSkills")}</span>
          <div className={styles.skills}>
            <span className={styles.emphasized}><Check size={13} aria-hidden="true" />React</span>
            <span className={styles.emphasized}><Check size={13} aria-hidden="true" />TypeScript</span>
            <span>SQL</span>
          </div>
        </div>
      )}
      {index === 2 && (
        <div className={styles.documentsResult}>
          <span className={styles.resultLabel}>{t("documents")}</span>
          <div className={styles.documents}>
            <span><FileText size={17} aria-hidden="true" />Resume.pdf</span>
            <span><FileText size={17} aria-hidden="true" />CoverLetter.pdf</span>
          </div>
        </div>
      )}
      <p className={styles.illustrative}>{t("illustrative")}</p>
    </motion.article>
  );
}

export function WorkflowStory({ activeStep, onStepChange, progress, reducedMotion = false, staticMode = false }: WorkflowStoryProps) {
  const t = useTranslations("landingExperience.story");
  const id = useId();
  const steps = t.raw("steps") as StoryStep[];
  const fallbackProgress = useMotionValue(activeStep / 2);
  const chapterProgress = progress ?? fallbackProgress;
  const completion = useTransform(chapterProgress, value => (Math.min(1, Math.max(0, value)) * 2 + 1) / 3);
  const staticLayout = staticMode || reducedMotion;

  useEffect(() => {
    if (!progress) fallbackProgress.jump(activeStep / 2);
  }, [activeStep, progress, fallbackProgress]);

  return (
    <section className={styles.story} data-static={staticLayout} aria-labelledby={`${id}-title`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>{t("eyebrow")}</p>
        <h2 id={`${id}-title`} className={styles.screenReaderOnly}>{t("title")}</h2>
        <p className={styles.screenReaderOnly}>{t("description")}</p>
      </header>
      <nav className={styles.navigation} aria-label={t("navigation")}>
        {steps.map((step, index) => (
          <button
            key={step.label}
            type="button"
            className={styles.chapterButton}
            aria-current={!staticLayout && activeStep === index ? "step" : undefined}
            aria-controls={`${id}-chapter-${index}`}
            onClick={() => onStepChange(index)}
          >
            <span className={styles.buttonNumber}>0{index + 1}</span>
            <span>{step.label}</span>
          </button>
        ))}
      </nav>
      <div className={styles.chapters}>
        {steps.map((step, index) => (
          <StoryChapter key={step.label} step={step} index={index} active={activeStep === index} staticMode={staticLayout} id={id} />
        ))}
      </div>
      <footer className={styles.footer}>
        <div className={styles.progressTrack} aria-hidden="true"><motion.span style={{ scaleX: staticLayout ? 1 : completion }} /></div>
        <div className={styles.footerActions}>
          <p className={styles.continue}><ArrowDown size={14} aria-hidden="true" />{t("continue")}</p>
          <a href="#demo" className={styles.skip}>{t("skip")}<ArrowRight size={14} aria-hidden="true" /></a>
        </div>
      </footer>
    </section>
  );
}
