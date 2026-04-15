"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowDown, Search, MapPin, BarChart3 } from "lucide-react";
import { renderBoldText } from "./renderBoldText";

const TYPING_INTERVAL_MS = 40;

type Scene = "search" | "tailor";

interface TailorSequence {
  jd: string;
  output: string;
  type: string;
}

export function TailoringDemoCard() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const searchTitle = t("demoSearchTitle");
  const searchLocation = t("demoSearchLocation");
  const searchLevel = t("demoSearchLevel");
  const searchResults = t("demoSearchResults");

  const sequences = useMemo<TailorSequence[]>(
    () => [
      { jd: t("demoJd1"), output: t("demoCv1"), type: t("demoType1") },
      { jd: t("demoJd2"), output: t("demoCl2"), type: t("demoType2") },
      { jd: t("demoJd3"), output: t("demoCv3"), type: t("demoType3") },
    ],
    [t],
  );

  const [scene, setScene] = useState<Scene>("search");
  const [tailorIndex, setTailorIndex] = useState(0);

  // Scene A state
  const [searchTyped, setSearchTyped] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [showShimmer, setShowShimmer] = useState(false);
  const [counter, setCounter] = useState(0);
  const [showCounter, setShowCounter] = useState(false);

  // Scene B state
  const [showJd, setShowJd] = useState(false);
  const [tailorTyped, setTailorTyped] = useState("");

  // Crossfade
  const [visible, setVisible] = useState(true);

  const typeText = useCallback(
    async (
      text: string,
      setter: React.Dispatch<React.SetStateAction<string>>,
      cancelled: { current: boolean },
    ) => {
      setter("");
      for (let i = 1; i <= text.length; i++) {
        if (cancelled.current) return;
        setter(text.slice(0, i));
        await new Promise((r) => setTimeout(r, TYPING_INTERVAL_MS));
      }
    },
    [],
  );

  const animateCounter = useCallback(
    (target: number, durationMs: number, cancelled: { current: boolean }) => {
      return new Promise<void>((resolve) => {
        const start = performance.now();
        function tick(now: number) {
          if (cancelled.current) {
            resolve();
            return;
          }
          const elapsed = now - start;
          const progress = Math.min(elapsed / durationMs, 1);
          // ease-out quad
          const eased = 1 - (1 - progress) * (1 - progress);
          const value = Math.round(eased * target);
          setCounter(value);
          if (progress < 1) {
            requestAnimationFrame(tick);
          } else {
            resolve();
          }
        }
        requestAnimationFrame(tick);
      });
    },
    [],
  );

  // Reset scene state helpers
  const resetSearchState = useCallback(() => {
    setSearchTyped("");
    setShowTags(false);
    setShowShimmer(false);
    setCounter(0);
    setShowCounter(false);
  }, []);

  const resetTailorState = useCallback(() => {
    setShowJd(false);
    setTailorTyped("");
  }, []);

  useEffect(() => {
    if (noMotion || reduceMotion === null) return;

    // Per-effect-instance cancellation token. Each effect run gets its own
    // object so that cleanup from a stale run can never "un-cancel" a live
    // run — the old shared cancelledRef caused a race where the new effect
    // set it back to false, reviving pending timeouts from the old loop
    // and producing mixed EN/CN output.
    const cancelled = { current: false };

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!cancelled.current) resolve();
        }, ms);
      });

    async function runLoop() {
      let tailorIdx = 0;

      while (!cancelled.current) {
        // --- Scene A: Job Search ---
        resetSearchState();
        resetTailorState();
        setScene("search");
        setVisible(true);
        await wait(300);
        if (cancelled.current) return;

        // Type search title
        await typeText(searchTitle, setSearchTyped, cancelled);
        if (cancelled.current) return;

        // Show tags
        await wait(200);
        if (cancelled.current) return;
        setShowTags(true);
        await wait(500);
        if (cancelled.current) return;

        // Shimmer
        setShowShimmer(true);
        await wait(1000);
        if (cancelled.current) return;
        setShowShimmer(false);

        // Counter
        setShowCounter(true);
        await animateCounter(128, 800, cancelled);
        if (cancelled.current) return;
        await wait(1700);
        if (cancelled.current) return;

        // Crossfade out
        setVisible(false);
        await wait(400);
        if (cancelled.current) return;

        // --- Scene B: AI Tailoring (cycle through 3 pairs) ---
        for (let pairIdx = 0; pairIdx < 3; pairIdx++) {
          const idx = (tailorIdx + pairIdx) % sequences.length;
          resetTailorState();
          setTailorIndex(idx);
          setScene("tailor");
          setVisible(true);
          await wait(300);
          if (cancelled.current) return;

          // Show JD
          setShowJd(true);
          await wait(500);
          if (cancelled.current) return;

          // Type output
          await typeText(sequences[idx].output, setTailorTyped, cancelled);
          if (cancelled.current) return;

          // Pause
          await wait(2000);
          if (cancelled.current) return;

          // Crossfade out (except after last pair, handled below)
          setVisible(false);
          await wait(400);
          if (cancelled.current) return;
        }

        tailorIdx = (tailorIdx + 3) % sequences.length;
      }
    }

    runLoop();
    return () => {
      cancelled.current = true;
    };
  }, [
    noMotion,
    reduceMotion,
    searchTitle,
    sequences,
    typeText,
    animateCounter,
    resetSearchState,
    resetTailorState,
  ]);

  // --- Reduced motion: static display ---
  if (noMotion) {
    return (
      <div
        className="edu-demo-card-v2 w-full max-w-md text-left"
        role="region"
        aria-label={t("demoLabel")}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            {t("demoLabel")}
          </span>
          <span className="text-xs font-medium text-slate-500">
            {t("demoSceneSearch")}
          </span>
        </div>

        {/* Static Scene A */}
        <div className="mt-4">
          <div className="flex items-center gap-2 rounded-lg border-2 border-slate-800 bg-white px-3 py-2 shadow-[0_6px_0_0_rgba(0,0,0,0.04)]">
            <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span className="text-sm text-slate-700">{searchTitle}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {searchLocation}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
              <BarChart3 className="h-3 w-3" aria-hidden="true" />
              {searchLevel}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-700">
            {searchResults.replace("{{count}}", "128")}
          </p>
        </div>

        {/* Static Scene B: all 3 pairs */}
        <div className="mt-6 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            {t("demoLabel")}
          </span>
          <span className="text-xs font-medium text-slate-500">
            {t("demoSceneTailor")}
          </span>
        </div>
        <div className="mt-3 space-y-4">
          {sequences.map((seq) => (
            <div key={seq.type} className="space-y-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <span className="text-xs font-medium text-slate-400">
                  {t("demoFromJd")}
                </span>
                <p className="mt-1 text-sm italic text-slate-600">
                  &ldquo;{seq.jd}&rdquo;
                </p>
              </div>
              <div className="flex justify-center">
                <ArrowDown className="h-4 w-4 text-slate-300" aria-hidden="true" />
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                <span className="text-xs font-medium text-emerald-600">
                  {t("demoAiOutput")} &middot; {seq.type}
                </span>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {renderBoldText(seq.output)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const currentSeq = sequences[tailorIndex];

  return (
    <motion.div
      className="edu-demo-card-v2 w-full max-w-md text-left"
      role="region"
      aria-label={t("demoLabel")}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.4, 0.25, 1] as const }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-500"
            aria-hidden="true"
          />
          {t("demoLabel")}
        </span>
        <span className="text-xs font-medium text-slate-500">
          {scene === "search" ? t("demoSceneSearch") : t("demoSceneTailor")}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{t("demoSubtitle")}</p>

      {/* Content region with crossfade */}
      <div
        className="mt-4 transition-opacity duration-[400ms]"
        style={{ opacity: visible ? 1 : 0 }}
        aria-live="polite"
      >
        {scene === "search" ? (
          /* ---------- Scene A: Job Search ---------- */
          <div className="space-y-3">
            {/* Search field */}
            <div className="flex items-center gap-2 rounded-lg border-2 border-slate-800 bg-white px-3 py-2 shadow-[0_6px_0_0_rgba(0,0,0,0.04)]">
              <Search className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden="true" />
              <span className="text-sm text-slate-700">
                {searchTyped}
                {searchTyped.length < searchTitle.length && (
                  <span className="edu-caret" aria-hidden="true" />
                )}
              </span>
            </div>

            {/* Tags */}
            <div
              className="flex items-center gap-2 transition-opacity duration-300"
              style={{ opacity: showTags ? 1 : 0 }}
            >
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {searchLocation}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                <BarChart3 className="h-3 w-3" aria-hidden="true" />
                {searchLevel}
              </span>
            </div>

            {/* Shimmer loading bar */}
            {showShimmer && <div className="edu-shimmer-bar" />}

            {/* Counter */}
            {showCounter && (
              <p className="text-sm font-medium text-slate-700">
                {searchResults.replace("{{count}}", String(counter))}
              </p>
            )}
          </div>
        ) : (
          /* ---------- Scene B: AI Tailoring ---------- */
          <div className="space-y-3">
            {/* JD block */}
            <div
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 transition-opacity duration-300"
              style={{ opacity: showJd ? 1 : 0 }}
            >
              <span className="text-xs font-medium text-slate-400">
                {t("demoFromJd")}
              </span>
              <p className="mt-1 text-sm italic text-slate-600">
                &ldquo;{currentSeq.jd}&rdquo;
              </p>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <ArrowDown
                className="h-4 w-4 animate-bounce text-slate-300"
                aria-hidden="true"
              />
            </div>

            {/* AI output block */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
              <span className="text-xs font-medium text-emerald-600">
                {t("demoAiOutput")} &middot; {currentSeq.type}
              </span>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {renderBoldText(tailorTyped)}
                {tailorTyped.length < currentSeq.output.length && (
                  <span className="edu-caret" aria-hidden="true" />
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
