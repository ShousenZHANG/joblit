"use client";

import { useEffect } from "react";

const chapterIds = ["overview", "workflow", "demo", "features", "documents", "organise", "get-started", "faq", "start"];

/** Correct the browser's initial fragment after hydration changes chapter sizes. */
export function useInitialLandingAnchor() {
  useEffect(() => {
    const initialHash = window.location.hash;
    let id: string;
    try { id = decodeURIComponent(initialHash.slice(1)); } catch { return; }
    if (!chapterIds.includes(id)) return;
    const main = document.getElementById("main-content");
    const target = document.getElementById(id);
    if (!main || !target || !main.contains(target)) return;

    let stopped = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let fontsReady = !document.fonts || document.fonts.status === "loaded";
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown", "hashchange"] as const;
    const stop = () => {
      stopped = true;
      clearTimeout(quietTimer);
      clearTimeout(deadline);
      observer.disconnect();
      for (const event of inputs) window.removeEventListener(event, stop, true);
    };
    const finish = () => {
      if (stopped) return;
      stop();
      if (window.location.hash !== initialHash || !target.isConnected) return;
      // Native alignment honors each section's scroll-margin and leaves focus,
      // the fragment, and browser history exactly where the visitor put them.
      target.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" });
    };
    const schedule = () => {
      if (stopped) return;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => { if (fontsReady) finish(); }, 180);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(main);
    for (const chapterId of chapterIds) {
      const chapter = document.getElementById(chapterId);
      if (chapter && main.contains(chapter)) observer.observe(chapter);
    }
    for (const event of inputs) window.addEventListener(event, stop, { capture: true, passive: true });
    // A stalled font or continuously resizing child must not retain a delayed
    // scroll correction indefinitely. User input always cancels first.
    const deadline = setTimeout(finish, 1800);
    if (!fontsReady) {
      document.fonts.ready.then(() => { fontsReady = true; schedule(); }, () => { fontsReady = true; schedule(); });
    }
    schedule();
    return stop;
  }, []);
}
