"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useMotionPreference } from "./lib/useMotionPreference";
import { useLandingMotionPaused } from "./lib/LandingMotion";
import styles from "./ScrollChapter.module.css";

const desktopQuery = "(min-width: 960px) and (min-height: 740px)";
const stageAllowance = 176; // 128px top clearance and 48px below the content.
const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const getDesktop = () => window.matchMedia(desktopQuery).matches;
const getServerDesktop = () => false;

type ChapterContextValue = { progress: MotionValue<number>; enabled: boolean; closing: boolean };
const ChapterContext = createContext<ChapterContextValue | null>(null);

type ScrollChapterProps = {
  id?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
  interactive?: boolean;
  closing?: boolean;
};

/** One-screen chapters when content fits, with uninterrupted native scrolling. */
export function ScrollChapter({ id, labelledBy, className, children, interactive = false, closing = false }: ScrollChapterProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const reduced = useMotionPreference();
  const paused = useLandingMotionPaused();
  const [fits, setFits] = useState(false);
  const [focused, setFocused] = useState(false);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
  const targetProgress = useMotionValue(scrollYProgress.get());
  const progress = useSpring(targetProgress, { stiffness: 240, damping: 38, restDelta: 0.0005 });
  const enhanced = desktop && !reduced;
  const fullScreen = enhanced && fits;
  const enabled = enhanced && !paused;
  const held = interactive && focused;
  const moving = enabled && !held;

  useMotionValueEvent(scrollYProgress, "change", value => {
    if (!moving) return;
    targetProgress.set(value);
    // Offscreen chapters do not need a spring's remaining settling frames.
    if (value <= 0 || value >= 1) progress.jump(value);
  });
  useEffect(() => {
    if (moving) {
      const value = scrollYProgress.get();
      targetProgress.set(value);
      if (value <= 0 || value >= 1) progress.jump(value);
      return;
    }
    // Focus freezes the current pose instead of snapping controls to a new
    // position. Pointer hover alone must not alter a scroll-driven scene.
    const value = enabled ? progress.get() : scrollYProgress.get();
    targetProgress.set(value);
    progress.jump(value);
  }, [enabled, moving, progress, scrollYProgress, targetProgress]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      // Layout dimensions ignore the scroll transform, avoiding a resize loop.
      const height = content.offsetHeight;
      setFits(height > 0 && height <= window.innerHeight - stageAllowance);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const rotateX = useTransform(progress, [0, 0.42, 0.72, 1], [8, 0, 0, closing ? 0 : -5]);
  const scale = useTransform(progress, [0, 0.42, 0.72, 1], [0.94, 1, 1, closing ? 1 : 0.98]);
  const y = useTransform(progress, [0, 0.42, 0.72, 1], [56, 0, 0, closing ? 0 : -24]);
  const context = useMemo(() => ({ progress, enabled, closing }), [progress, enabled, closing]);

  return <section
    ref={sectionRef}
    id={id}
    aria-labelledby={labelledBy}
    className={[styles.chapter, className].filter(Boolean).join(" ")}
    data-scroll-chapter=""
    data-chapter-layout={fullScreen ? "screen" : "flow"}
    data-chapter-still={!moving ? "true" : undefined}
    data-chapter-closing={closing ? "true" : undefined}
  >
    <div className={styles.stage}>
      <motion.div
        ref={contentRef}
        className={styles.camera}
        style={{ rotateX, scale, y }}
        transformTemplate={enabled ? undefined : () => "none"}
        onFocusCapture={interactive ? () => setFocused(true) : undefined}
        onBlurCapture={interactive ? event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        } : undefined}
      >
        <ChapterContext.Provider value={context}>{children}</ChapterContext.Provider>
      </motion.div>
    </div>
  </section>;
}

/** A small relative depth, driven by its chapter's one shared scroll signal. */
export function DepthLayer({ children, className, depth = 1, tilt = 0 }: {
  children: ReactNode;
  className?: string;
  depth?: number;
  tilt?: number;
}) {
  const chapter = useContext(ChapterContext);
  const fallback = useMotionValue(0.5);
  const progress = chapter?.progress ?? fallback;
  const amount = Math.min(2, Math.max(-2, depth));
  const angle = Math.min(8, Math.max(-8, tilt));
  const y = useTransform(progress, [0, 0.42, 0.72, 1], [24 * amount, 0, 0, chapter?.closing ? 0 : -16 * amount]);
  const z = useTransform(progress, [0, 0.42, 0.72, 1], [-32 * amount, 0, 0, chapter?.closing ? 0 : -16 * amount]);
  const rotateY = useTransform(progress, [0, 0.42, 0.72, 1], [angle, 0, 0, chapter?.closing ? 0 : -angle * 0.5]);

  return <motion.div
    className={[styles.layer, className].filter(Boolean).join(" ")}
    style={{ y, z, rotateY }}
    transformTemplate={chapter?.enabled ? undefined : () => "none"}
  >{children}</motion.div>;
}
