"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, stagger, useReveal } from "./lib/motion";

// Deep-dive #1 — resume studio before/after. Two stacked card mocks with
// placeholder bars representing bullet points. Highlight blocks on the
// "After" side are the emerald call-outs that appear after tailoring.


/** Pill-shaped skeleton bar used to mock resume bullet lines. */
function Bar({ width, highlight = false }: { width: string; highlight?: boolean }) {
  return (
    <div
      className={
        "h-2.5 rounded-full " +
        (highlight ? "bg-brand-emerald-500" : "bg-border/70")
      }
      style={{ width }}
      aria-hidden
    />
  );
}

export function DeepDiveResume() {
  const reveal = useReveal();
  const t = useTranslations("landing.deepDive.resume");
  const BULLETS = [t("b1"), t("b2"), t("b3"), t("b4")];
  return (
    <motion.section
      {...reveal}
      data-testid="landing-deepdive-resume"
      className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10"
      variants={fadeUp}
    >
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <motion.div variants={stagger}>
          <motion.div
            variants={fadeUp}
            className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-emerald-700"
          >
            <span aria-hidden className="inline-block h-px w-4 bg-brand-emerald-600" />
            {t("kicker")}
          </motion.div>
          <motion.h3
            variants={fadeUp}
            className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            {t("titlePrefix")}{" "}
            <em className="font-serif italic text-brand-emerald-700">
              {t("titleItalic")}
            </em>
          </motion.h3>
          <motion.p
            variants={fadeUp}
            className="mt-4 text-base leading-relaxed text-muted-foreground"
          >
            {t("lede")}
          </motion.p>
          <motion.ul variants={stagger} className="mt-6 flex flex-col gap-3">
            {BULLETS.map((b) => (
              <motion.li
                key={b}
                variants={fadeUp}
                className="flex items-start gap-2 text-sm text-foreground/90"
              >
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-600"
                  strokeWidth={3}
                  aria-hidden
                />
                {b}
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        <motion.div
          variants={fadeUp}
          className="grid grid-cols-2 gap-3 rounded-3xl border border-border/60 bg-background p-5 shadow-[var(--shadow-card-emerald)]"
        >
          {/* Before */}
          <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("before")}
              </span>
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">
                Alex Chen
              </div>
              <div className="text-xs text-muted-foreground">
                {t("roleBefore")}
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Bar width="90%" />
              <Bar width="70%" />
              <Bar width="50%" />
              <Bar width="90%" />
              <Bar width="70%" />
            </div>
          </div>

          {/* After */}
          <div className="flex flex-col gap-3 rounded-xl border border-brand-emerald-200 bg-brand-emerald-50/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-emerald-700">
                {t("after")}
              </span>
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">
                Alex Chen
              </div>
              <div className="text-xs text-brand-emerald-700">
                {t("roleAfter")}
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Bar width="90%" highlight />
              <div className="rounded-md bg-brand-emerald-100 px-2 py-1.5 text-[11px] font-medium text-brand-emerald-800">
                {t("h1")}
              </div>
              <Bar width="70%" highlight />
              <Bar width="50%" />
              <div className="rounded-md bg-brand-emerald-100 px-2 py-1.5 text-[11px] font-medium text-brand-emerald-800">
                {t("h2")}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
