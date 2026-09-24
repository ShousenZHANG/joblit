"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./PageChapterNav.module.css";

const chapters = ["overview", "workflow", "demo", "features", "documents", "organise", "get-started", "faq", "start"] as const;
const railQuery = "(min-width: 1440px) and (min-height: 740px)";

/** A quiet page map. Links preserve the browser's native scrolling and history. */
export function PageChapterNav() {
  const t = useTranslations("landingExperience.pageNavigation");
  const [current, setCurrent] = useState<string>(chapters[0]);
  const fill = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const media = window.matchMedia(railQuery);
    let frame: number | null = null;
    let layoutChanged = true;
    let anchors: { id: string; top: number }[] = [];
    let scrollLength = 0;

    // Section offsets move only when layout does. Reading them on every scroll
    // frame would force a synchronous layout right after the frame's
    // transforms were written; measure on layout change, then do arithmetic.
    const measureLayout = () => {
      const scrollTop = window.scrollY;
      anchors = chapters.flatMap(id => {
        const element = document.getElementById(id);
        return element ? [{ id, top: element.getBoundingClientRect().top + scrollTop }] : [];
      });
      scrollLength = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      layoutChanged = false;
    };
    const update = () => {
      frame = null;
      if (!media.matches) return;
      if (layoutChanged) measureLayout();
      if (!anchors.length) return;

      const scrollTop = window.scrollY;
      const readingLine = scrollTop + window.innerHeight * 0.3;
      let selected = anchors[0].id;
      for (const anchor of anchors) {
        if (anchor.top <= readingLine) selected = anchor.id;
      }
      // The last chapter can be shorter than a viewport; it still owns the
      // end of the page instead of leaving the previous dot selected.
      if (scrollLength > 0 && scrollTop >= scrollLength - 2) selected = anchors.at(-1)!.id;
      setCurrent(selected);
      if (fill.current) {
        const progress = scrollLength > 0 ? Math.min(1, Math.max(0, scrollTop / scrollLength)) : 0;
        fill.current.style.transform = `scaleY(${progress})`;
      }
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(update);
    };
    const remeasure = () => {
      layoutChanged = true;
      schedule();
    };

    const resizeObserver = new ResizeObserver(remeasure);
    // FAQ expansion, locale changes and the interactive demo can all change
    // section positions without a window resize or a new scroll event.
    resizeObserver.observe(document.getElementById("main-content") ?? document.documentElement);
    for (const id of chapters) {
      const element = document.getElementById(id);
      if (element) resizeObserver.observe(element);
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    media.addEventListener("change", remeasure);
    remeasure();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      media.removeEventListener("change", remeasure);
    };
  }, []);

  return (
    <nav className={styles.rail} aria-label={t("label")}>
      <div className={styles.track} aria-hidden="true"><span ref={fill} /></div>
      <ol className={styles.chapters}>
        {chapters.map(id => (
          <li key={id}>
            <a className={styles.link} href={`#${id}`} aria-label={t(id)} aria-current={current === id ? "location" : undefined}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.tooltip} aria-hidden="true">{t(id)}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
