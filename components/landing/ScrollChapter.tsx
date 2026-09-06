"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useMotionPreference } from "./lib/useMotionPreference";
import { useLandingMotionPaused } from "./lib/LandingMotion";
import styles from "./ScrollChapter.module.css";

const desktopQuery = "(min-width: 960px) and (min-height: 740px)";
const stageAllowance = 176; // 104px nav, 24px bottom, 24px padding on each side.
const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const getDesktop = () => window.matchMedia(desktopQuery).matches;
const getServerDesktop = () => false;

type ChapterContextValue = { progress: MotionValue<number>; moving: boolean; closing: boolean };
const ChapterContext = createContext<ChapterContextValue | null>(null);

type ScrollChapterProps = {
  id?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
  interactive?: boolean;
  closing?: boolean;
};

/** Native scrolling with a reading hold, only when the complete content fits. */
export function ScrollChapter({ id, labelledBy, className, children, interactive = false, closing = false }: ScrollChapterProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const reduced = useMotionPreference();
  const paused = useLandingMotionPaused();
  const [fits, setFits] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
  const progress = useSpring(scrollYProgress, { stiffness: 240, damping: 38, restDelta: 0.0005 });
  const enhanced = desktop && !reduced;
  const pinned = enhanced && fits;
  const moving = enhanced && !paused && !(interactive && (hovered || focused));
  const trackPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    // Reading text should retain its scroll entrance. Only a control or an
    // explicitly interactive surface needs a steady target under the pointer.
    const overControl = event.target instanceof Element && Boolean(event.target.closest(
      "a, button, input, textarea, select, summary, [role='button'], [role='tab'], [data-chapter-interactive]",
    ));
    if (overControl !== hovered) setHovered(overControl);
  };

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
  const context = useMemo(() => ({ progress, moving, closing }), [progress, moving, closing]);

  return <section
    ref={sectionRef}
    id={id}
    aria-labelledby={labelledBy}
    className={[styles.chapter, className].filter(Boolean).join(" ")}
    data-scroll-chapter=""
    data-chapter-layout={pinned ? "pinned" : "flow"}
    data-chapter-still={!moving ? "true" : undefined}
    data-chapter-closing={closing ? "true" : undefined}
  >
    <div className={styles.stage}>
      <motion.div
        ref={contentRef}
        className={styles.camera}
        style={moving ? { rotateX, scale, y } : { transform: "none" }}
        onPointerEnter={interactive ? trackPointer : undefined}
        onPointerMove={interactive ? trackPointer : undefined}
        onPointerLeave={interactive ? () => setHovered(false) : undefined}
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
    style={chapter?.moving ? { y, z, rotateY } : { transform: "none" }}
  >{children}</motion.div>;
}
