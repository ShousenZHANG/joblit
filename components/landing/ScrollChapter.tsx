"use client";

import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useMotionPreference } from "./lib/useMotionPreference";
import { useLandingMotionPaused } from "./lib/LandingMotion";
import styles from "./ScrollChapter.module.css";

const desktopQuery = "(min-width: 960px) and (min-height: 740px)";
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
  closing?: boolean;
};

/**
 * A chapter in normal document flow. Its text never moves: a transformed text
 * layer loses subpixel antialiasing and re-rasterizes while it scrolls. Only
 * decorative DepthLayers drift, by translation locked to native scroll.
 */
export function ScrollChapter({ id, labelledBy, className, children, closing = false }: ScrollChapterProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const reduced = useMotionPreference();
  const paused = useLandingMotionPaused();
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
  const enabled = desktop && !reduced && !paused;
  const context = useMemo(() => ({ progress: scrollYProgress, enabled, closing }), [scrollYProgress, enabled, closing]);

  return <section
    ref={sectionRef}
    id={id}
    aria-labelledby={labelledBy}
    className={[styles.chapter, className].filter(Boolean).join(" ")}
    data-scroll-chapter=""
    data-chapter-still={enabled ? undefined : "true"}
    data-chapter-closing={closing ? "true" : undefined}
  >
    <div className={styles.stage}>
      <ChapterContext.Provider value={context}>{children}</ChapterContext.Provider>
    </div>
  </section>;
}

/**
 * Decorative parallax for illustrations. Translation only, mapped directly to
 * scroll with no spring, so the layer never lags behind the page. It rests at
 * zero when its chapter is centred. Never wrap controls in it: a target that
 * drifts under the pointer is harder to hit.
 */
export function DepthLayer({ children, className, depth = 1 }: {
  children: ReactNode;
  className?: string;
  depth?: number;
}) {
  const chapter = useContext(ChapterContext);
  const fallback = useMotionValue(0.5);
  const progress = chapter?.progress ?? fallback;
  const travel = 28 * Math.min(2, Math.max(0, depth));
  // The final chapter never scrolls fully out of view, so it keeps its rest pose.
  const y = useTransform(progress, [0, 0.5, 1], [travel, 0, chapter?.closing ? 0 : -travel]);

  return <motion.div
    className={[styles.layer, className].filter(Boolean).join(" ")}
    style={{ y }}
    transformTemplate={chapter?.enabled ? undefined : () => "none"}
  >{children}</motion.div>;
}
