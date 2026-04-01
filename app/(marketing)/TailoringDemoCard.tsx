"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { renderBoldText } from "./renderBoldText";

interface DemoSequence {
  jd: string;
  output: string;
  type: string;
}

function useSequences(t: ReturnType<typeof useTranslations>): DemoSequence[] {
  return [
    { jd: t("demoJd1"), output: t("demoCv1"), type: t("demoType1") },
    { jd: t("demoJd2"), output: t("demoCl2"), type: t("demoType2") },
    { jd: t("demoJd3"), output: t("demoCv3"), type: t("demoType3") },
  ];
}

export function TailoringDemoCard() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;
  const sequences = useSequences(t);

  const [activeIndex, setActiveIndex] = useState(0);
  const [displayedOutput, setDisplayedOutput] = useState(
    noMotion ? sequences[0].output : "",
  );
  const [isFading, setIsFading] = useState(false);

  const typeOutput = useCallback(
    async (text: string, cancelled: { current: boolean }) => {
      setDisplayedOutput("");
      for (let i = 1; i <= text.length; i += 1) {
        if (cancelled.current) return;
        setDisplayedOutput(text.slice(0, i));
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    },
    [],
  );

  useEffect(() => {
    if (noMotion) return;

    const cancelled = { current: false };
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    async function run() {
      // Type initial sequence
      await typeOutput(sequences[0].output, cancelled);
      await sleep(3000);

      let index = 1;
      while (!cancelled.current) {
        // Fade out
        setIsFading(true);
        await sleep(300);
        if (cancelled.current) return;

        // Switch to next sequence
        setIsFading(false);
        setActiveIndex(index);
        setDisplayedOutput("");

        // Type output
        await typeOutput(sequences[index].output, cancelled);
        await sleep(3000);

        index = (index + 1) % sequences.length;
      }
    }

    run();
    return () => {
      cancelled.current = true;
    };
  }, [noMotion, sequences, typeOutput]);

  const current = sequences[activeIndex];

  if (noMotion) {
    return (
      <div
        className="edu-demo-card w-full max-w-md text-left"
        role="region"
        aria-label={t("demoLabel")}
      >
        <div className="flex items-center gap-2">
          <span className="edu-pill-pro inline-flex items-center gap-1.5 text-xs font-semibold">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            {t("demoLabel")}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("demoSubtitle")}</p>
        <div className="mt-4 space-y-4">
          {sequences.map((seq, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="text-xs font-medium text-slate-400">
                  {seq.type}
                </span>
                <p className="mt-1 text-sm italic text-slate-500">
                  &ldquo;{seq.jd}&rdquo;
                </p>
              </div>
              <div>
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

  return (
    <motion.div
      className="edu-demo-card w-full max-w-md text-left"
      role="region"
      aria-label={t("demoLabel")}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.4, 0.25, 1] as const }}
    >
      <div className="flex items-center gap-2">
        <span className="edu-pill-pro inline-flex items-center gap-1.5 text-xs font-semibold">
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-500"
            aria-hidden="true"
          />
          {t("demoLabel")}
        </span>
        <span className="text-xs font-medium text-slate-500">
          {current.type}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{t("demoSubtitle")}</p>

      <div
        className={`mt-4 grid gap-3 transition-opacity duration-300 sm:grid-cols-2 ${
          isFading ? "opacity-0" : "opacity-100"
        }`}
      >
        <div>
          <p className="text-sm italic text-slate-500">
            &ldquo;{current.jd}&rdquo;
          </p>
        </div>
        <div aria-live="polite">
          <p className="text-sm font-medium text-slate-900">
            {renderBoldText(displayedOutput)}
            {displayedOutput.length < current.output.length && (
              <span className="edu-caret" />
            )}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
