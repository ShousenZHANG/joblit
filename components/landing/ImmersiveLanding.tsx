"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Pause, Play } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Component, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApplicationDemo } from "./ApplicationDemo";
import { LandingNav } from "./LandingNav";
import { ProductSections } from "./ProductSections";
import { PageChapterNav } from "./PageChapterNav";
import { WorkflowStory } from "./WorkflowStory";
import { WorkstationPoster } from "./WorkstationPoster";
import { useCtaHref } from "./lib/useCtaHref";
import { useMotionPreference } from "./lib/useMotionPreference";
import { useWorkflowProgress } from "./lib/useWorkflowProgress";
import { useInitialLandingAnchor } from "./lib/useInitialLandingAnchor";
import { LandingMotionProvider } from "./lib/LandingMotion";
import styles from "./ImmersiveLanding.module.css";

const WorkstationScene = dynamic(() => import("./WorkstationScene"), { ssr: false });

class SceneBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function ImmersiveLanding() {
  useInitialLandingAnchor();
  const t = useTranslations("landingExperience");
  const cta = useCtaHref();
  const reduced = useMotionPreference();
  const { resolvedTheme } = useTheme();
  const journey = useRef<HTMLElement>(null);
  const workflow = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const { progress, activeStep, enhanced, selectStep } = useWorkflowProgress(workflow, reduced, paused);
  const [requested, setRequested] = useState(false);
  const [readiness, setReadiness] = useState({ reduced, ready: false });
  // A changed motion preference replaces the canvas. Keep its poster until the
  // newly mounted renderer presents a frame, even if an earlier canvas was ready.
  if (readiness.reduced !== reduced) setReadiness({ reduced, ready: false });
  const ready = readiness.reduced === reduced && readiness.ready;
  const [unavailable, setUnavailable] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    if (journey.current) observer.observe(journey.current);
    const onVisibility = () => setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  useEffect(() => {
    if (requested || !visible || !pageVisible || reduced) return;
    const timer = window.setTimeout(() => setRequested(true), 250);
    return () => window.clearTimeout(timer);
  }, [requested, visible, pageVisible, reduced]);
  const sceneActive = requested && !reduced && !unavailable;
  return <LandingMotionProvider paused={paused}><div className={styles.landing}>
    <LandingNav motionControl={!reduced ? <button type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? t("hero.resume") : t("hero.pause")} className={styles.motionControl}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}</button> : undefined} />
    <PageChapterNav />
    <main id="main-content" tabIndex={-1}>
      <section ref={journey} className={styles.journey} aria-labelledby="landing-title" data-layout={enhanced ? "cinematic" : "flow"} data-scene-state={reduced ? "reduced-motion" : unavailable ? "unavailable" : ready ? "ready" : requested ? "loading" : "pending"}>
        <div className={styles.stage}>
          <div className={styles.sceneDock} aria-hidden="true">
            <div className={`${styles.posterLayer} ${ready && sceneActive ? styles.posterHidden : ""}`}><WorkstationPoster className={styles.poster} /></div>
            {sceneActive && <div className={styles.canvasLayer}><SceneBoundary onUnavailable={() => setUnavailable(true)}><WorkstationScene dark={resolvedTheme === "dark"} progress={progress} paused={paused || !visible || !pageVisible} onReady={() => setReadiness({ reduced, ready: true })} onUnavailable={() => setUnavailable(true)} /></SceneBoundary></div>}
          </div>
          <div className={styles.stageFloor} aria-hidden="true" />
        </div>
        <div id="overview" className={styles.hero} tabIndex={-1}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span />{t("hero.eyebrow")}</p>
            <h1 id="landing-title">{t("hero.title1")}<br /><span className={styles.titleAccent}>{t("hero.title2")}<svg viewBox="0 0 500 14" preserveAspectRatio="none" aria-hidden="true"><path d="M4 10C136 2 332 3 496 8" /></svg></span></h1>
            <p className={styles.heroDescription}>{t("hero.description")}</p>
            <div className={styles.heroActions}><a href="#demo" className={styles.primary}><Play size={15} aria-hidden="true" fill="currentColor" />{t("hero.primary")}<ArrowRight size={17} aria-hidden="true" /></a><Link href={cta.href} prefetch={cta.prefetch} className={styles.secondary}>{t("hero.secondary")}<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
            <ul className={styles.proof}>{(["proof1", "proof2", "proof3"] as const).map(key => <li key={key}><Check size={13} aria-hidden="true" />{t(`hero.${key}`)}</li>)}</ul>
          </div>
          <div className={styles.heroBottom}>
            <a href="#workflow" className={styles.scrollHint}><span className={styles.scrollIcon}><ArrowDown size={15} aria-hidden="true" /></span>{t("hero.scroll")}</a>
            <div className={styles.sceneCaption} aria-label={t("hero.sceneLabel")}><span className={styles.sceneIndex}>01 — 03</span><span>JOBLIT / WORKSTATION</span></div>
          </div>
        </div>
        <div ref={workflow} id="workflow" className={styles.story}>
          <div className={styles.storyContent}><WorkflowStory activeStep={activeStep} onStepChange={selectStep} progress={progress} reducedMotion={reduced} staticMode={!enhanced} /></div>
        </div>
      </section>
      <div className={styles.content}><ApplicationDemo /><ProductSections /></div>
    </main>
  </div></LandingMotionProvider>;
}
