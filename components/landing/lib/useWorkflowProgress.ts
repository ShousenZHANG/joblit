"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useMotionValue, useMotionValueEvent, useScroll, useSpring } from "framer-motion";

// Small/short screens get the complete story in normal document flow.
const cinematicQuery = "(min-width: 960px) and (min-height: 740px)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(cinematicQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const getSnapshot = () => window.matchMedia(cinematicQuery).matches;
const getServerSnapshot = () => false;

/** Reading holds separate the two reversible scene transitions. */
export function getWorkflowProgress(scroll: number) {
  if (!Number.isFinite(scroll)) return 0;
  const p = Math.min(1, Math.max(0, scroll));
  const transition = (start: number, end: number) => {
    const x = Math.min(1, Math.max(0, (p - start) / (end - start)));
    return x * x * (3 - 2 * x);
  };
  return (transition(.18, .4) + transition(.6, .82)) / 2;
}

export function useWorkflowProgress(target: RefObject<HTMLDivElement | null>, reducedMotion: boolean, paused = false) {
  const canPin = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const enhanced = canPin && !reducedMotion;
  const sceneTarget = useMotionValue(0);
  const progress = useSpring(sceneTarget, { stiffness: 220, damping: 34, restDelta: .0005 });
  const [activeStep, setActiveStep] = useState(0);
  const { scrollYProgress } = useScroll({ target, offset: ["start start", "end end"] });

  useMotionValueEvent(scrollYProgress, "change", value => {
    if (!enhanced) return;
    const next = getWorkflowProgress(value);
    sceneTarget.set(paused ? Math.round(next * 2) / 2 : next);
    if (paused) progress.jump(sceneTarget.get());
  });
  useMotionValueEvent(progress, "change", value => {
    setActiveStep(Math.min(2, Math.max(0, Math.round(value * 2))));
  });
  useEffect(() => {
    // Reconcile after resize/preference changes, including restored scroll.
    const value = enhanced ? getWorkflowProgress(scrollYProgress.get()) : 0;
    const next = paused ? Math.round(value * 2) / 2 : value;
    sceneTarget.set(next);
    progress.jump(next);
  }, [enhanced, paused, progress, sceneTarget, scrollYProgress]);

  const selectStep = (index: number) => {
    const container = target.current;
    if (!container) return;
    const step = Math.min(2, Math.max(0, index));
    if (!enhanced) {
      container.querySelector<HTMLElement>(`[data-workflow-chapter="${step}"]`)
        ?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
      return;
    }
    // Buttons navigate the same native scroll timeline as wheel, touch and
    // keyboard input. No manual selection latch or scroll interception.
    const bounds = container.getBoundingClientRect();
    const travel = Math.max(0, bounds.height - window.innerHeight);
    const restingPoint = [.08, .5, .92][step];
    window.scrollTo({ top: window.scrollY + bounds.top + travel * restingPoint, behavior: "smooth" });
  };

  return { progress, activeStep, enhanced, selectStep };
}
