"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, stagger, useReveal } from "./lib/motion";

// Deep-dive #3 — parallel fetch across boards. The 5 progress rows
// include one "running" row with a shimmer strip (CSS keyframe
// `landing-shimmer` declared in globals.css) and one "queued" row sitting
// at zero to telegraph that the pipeline is ongoing.

interface FetchRow {
  source: string;
  percent: number;
  count: number | null;
  status: "done" | "running" | "queued";
}

const ROWS: FetchRow[] = [
  { source: "LinkedIn", percent: 100, count: 124, status: "done" },
  { source: "Greenhouse", percent: 100, count: 47, status: "done" },
  { source: "Lever", percent: 100, count: 31, status: "done" },
  { source: "Workable", percent: 68, count: 18, status: "running" },
  { source: "Indeed", percent: 0, count: null, status: "queued" },
];

const STATUS_STYLE: Record<FetchRow["status"], string> = {
  done: "bg-brand-emerald-100 text-brand-emerald-700",
  running: "bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]",
  queued: "bg-muted text-muted-foreground",
};

export function DeepDiveFetch() {
  const reveal = useReveal();
  const t = useTranslations("landing.deepDive.fetch");
  const BULLETS = [t("b1"), t("b2"), t("b3"), t("b4")];
  const STATUS_LABEL: Record<FetchRow["status"], string> = {
    done: t("statusDone"),
    running: t("statusRunning"),
    queued: t("statusQueued"),
  };
  return (
    <motion.section
      {...reveal}
      data-testid="landing-deepdive-fetch"
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
          className="relative rounded-3xl border border-border/60 bg-background p-6 shadow-[var(--shadow-card-emerald)]"
        >
          <div className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("header")}
          </div>
          <ul className="flex flex-col gap-3" role="list">
            {ROWS.map((row) => (
              <li
                key={row.source}
                className="flex items-center gap-4 rounded-xl border border-border/50 bg-muted/30 px-4 py-3"
              >
                <span className="min-w-20 text-sm font-semibold text-foreground">
                  {row.source}
                </span>
                <div className="relative flex-1 overflow-hidden rounded-full bg-border/50">
                  <div
                    className={
                      "h-2 rounded-full transition-[width] duration-700 ease-out " +
                      (row.status === "running"
                        ? "bg-[length:200%_100%] bg-gradient-to-r from-brand-emerald-600 via-[#34d399] to-brand-emerald-600 animate-[landing-shimmer_1.8s_linear_infinite]"
                        : "bg-brand-emerald-600")
                    }
                    style={{ width: `${row.percent}%` }}
                    aria-hidden
                  />
                </div>
                <span className="min-w-10 text-right text-xs tabular-nums text-muted-foreground">
                  {row.count ?? "—"}
                </span>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                    STATUS_STYLE[row.status]
                  }
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex items-center justify-between rounded-2xl bg-gradient-to-br from-brand-emerald-600 to-brand-emerald-700 px-5 py-4 text-white">
            <span className="text-sm font-semibold uppercase tracking-wider">
              {t("total")}
            </span>
            <span className="text-3xl font-bold tabular-nums">220</span>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
