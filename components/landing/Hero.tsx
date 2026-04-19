"use client";

import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  MapPin,
  Play,
  Search,
  Star,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fadeUp, floatIn, stagger } from "./lib/motion";

// Hero — the biggest single block on the page. Sections:
//   1. Eyebrow + pulsing green dot ("New · Self-learning extension").
//   2. Hero title with italic serif emphasis + subtitle + dual CTA.
//   3. Meta strip — "4,281 applications tailored this week · Free forever".
//   4. Hero canvas: 3-column product mock (sidebar + job list + detail)
//      with a score bar that animates from 0 → 88% on mount.
//   5. Three floating callouts that fade in around the canvas at
//      staggered delays (0.3s / 0.6s / 0.9s).
//
// Tilt / parallax from Landing.html is intentionally omitted — it looked
// great on desktop but reads as noise on touch devices and introduces a
// scroll-jank risk inside a Next.js page. The product mock is already
// busy enough on its own.

interface JobRow {
  title: string;
  company: string;
  location: string;
  score: number;
  tier: "strong" | "good" | "fair" | "weak";
  timeAgo: string;
}

const JOB_ROWS: JobRow[] = [
  {
    title: "Sr. Frontend Engineer",
    company: "Stripe",
    location: "San Francisco",
    score: 88,
    tier: "strong",
    timeAgo: "3h",
  },
  {
    title: "Staff Product Designer",
    company: "Linear",
    location: "Remote",
    score: 74,
    tier: "good",
    timeAgo: "5h",
  },
  {
    title: "Design Engineer",
    company: "Figma",
    location: "New York",
    score: 81,
    tier: "strong",
    timeAgo: "1d",
  },
  {
    title: "Platform Engineer",
    company: "PlanetScale",
    location: "Remote",
    score: 52,
    tier: "fair",
    timeAgo: "2d",
  },
];

const TIER_BG: Record<JobRow["tier"], string> = {
  strong: "bg-brand-emerald-100 text-brand-emerald-700",
  good: "bg-[theme(colors.tier-good-bg)] text-[theme(colors.tier-good-fg)]",
  fair: "bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]",
  weak: "bg-[theme(colors.tier-weak-bg)] text-[theme(colors.tier-weak-fg)]",
};

export function Hero() {
  const reduced = useReducedMotion();
  const [activeRow, setActiveRow] = useState(0);
  const t = useTranslations("landing.hero");

  // Rotate the "active" row every 2.6s — matches Landing.html JS.
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setActiveRow((i) => (i + 1) % JOB_ROWS.length);
    }, 2600);
    return () => window.clearInterval(id);
  }, [reduced]);

  // Orchestrated intro: one stagger parent drives all headline elements
  // so delays stay in lockstep and motion reads as a single choreographed
  // reveal instead of five independent fades.
  const introStagger = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: 0.09,
        delayChildren: 0.05,
      },
    },
  };
  const introItem = reduced
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.4 } },
      }
    : {
        hidden: { opacity: 0, y: 28 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.72, ease: [0.16, 1, 0.3, 1] as const },
        },
      };

  return (
    <section
      data-testid="landing-hero"
      className="relative mx-auto w-full max-w-6xl px-6 pb-24 pt-16 sm:pt-24 lg:px-10"
    >
      <motion.div
        variants={introStagger}
        initial="hidden"
        animate="show"
      >
      {/* Eyebrow — first thing to appear on page load, bolder
          20px rise so the motion reads even on fast connections. */}
      <motion.div
        variants={introItem}
        className="flex items-center justify-center"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-emerald-200 bg-brand-emerald-50 px-3 py-1 text-xs font-semibold text-brand-emerald-700">
          <span
            aria-hidden
            className="relative flex h-1.5 w-1.5 items-center justify-center"
          >
            <span className="absolute inline-flex h-full w-full animate-[landing-pulse_2s_ease-in-out_infinite] rounded-full bg-brand-emerald-500" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-brand-emerald-600" />
          </span>
          <span className="rounded-full bg-brand-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {t("eyebrowNew")}
          </span>
          {t("eyebrowTagline")}
        </span>
      </motion.div>

      {/* Title */}
      <motion.h1
        variants={introItem}
        className="mx-auto mt-6 max-w-3xl text-balance text-center text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl"
      >
        {t("titleLine1")}
        <br />
        <em className="bg-gradient-to-br from-brand-emerald-700 via-brand-emerald-600 to-[#14b8a6] bg-clip-text font-serif italic text-transparent">
          {t("titleItalic")}
        </em>
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        variants={introItem}
        className="mx-auto mt-6 max-w-2xl text-balance text-center text-base leading-relaxed text-muted-foreground sm:text-lg"
      >
        {t("subtitle")}
      </motion.p>

      {/* CTA */}
      <motion.div
        variants={introItem}
        className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
      >
        <Link
          href="/login"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background transition-transform hover:-translate-y-px hover:bg-foreground/90"
        >
          {t("startFree")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="#how"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-background/70 px-6 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <Play className="h-4 w-4" aria-hidden />
          {t("watchDemo")}
        </Link>
      </motion.div>

      {/* Meta */}
      <motion.div
        variants={introItem}
        className="mt-6 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground sm:flex-row sm:gap-4"
      >
        <span>
          {t("metaCount", { count: "4,281" })}
        </span>
        <span aria-hidden className="hidden h-1 w-1 rounded-full bg-border sm:block" />
        <span>{t("metaFree")}</span>
      </motion.div>

      {/* Canvas — frame lifts in with bigger rise + scale so it reads
          as the hero visual settling into place. Still part of the
          orchestrated intro cascade via variants. */}
      <motion.div
        variants={{
          hidden: reduced
            ? { opacity: 0 }
            : { opacity: 0, y: 56, scale: 0.98 },
          show: {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: {
              duration: 0.95,
              ease: [0.16, 1, 0.3, 1] as const,
            },
          },
        }}
        className="relative mx-auto mt-16 max-w-5xl"
      >
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-background shadow-[var(--shadow-elevated-emerald)]">
          {/* App mock: phones get a single stacked column; ≥sm gets
              list + detail (sidebar hidden); ≥md gets the full 3-col.
              Columns mount with a 90/130/170 ms cascade after the
              canvas frame lifts in, so the product mock reads as
              "assembling itself" rather than snapping into place. */}
          <motion.div
            variants={stagger}
            initial={reduced ? undefined : "hidden"}
            animate="show"
            transition={{ delayChildren: 0.55, staggerChildren: 0.09 }}
            className="grid min-h-[360px] grid-cols-1 sm:grid-cols-[260px_1fr] md:grid-cols-[180px_260px_1fr]"
          >
            {/* Sidebar */}
            <motion.div
              variants={fadeUp}
              className="hidden border-r border-border/50 bg-muted/30 p-4 text-sm md:block"
            >
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
                  <Search className="h-3.5 w-3.5 text-brand-emerald-700" aria-hidden />
                </span>
                Joblit
              </div>
              <ul className="flex flex-col gap-1 text-xs">
                <li className="flex items-center justify-between rounded-md bg-brand-emerald-50 px-2 py-1.5 font-semibold text-brand-emerald-700">
                  <span className="inline-flex items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5" aria-hidden />
                    Jobs
                  </span>
                  <span className="rounded bg-brand-emerald-100 px-1.5 text-[10px]">
                    47
                  </span>
                </li>
                {[
                  { label: "Fetch", badge: 3 },
                  { label: "Resume", badge: 2 },
                  { label: "Discover", badge: null },
                  { label: "Extension", badge: null },
                ].map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <span>{item.label}</span>
                    {item.badge !== null && (
                      <span className="rounded bg-muted px-1.5 text-[10px]">
                        {item.badge}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Job list — rows stagger in after the column fade, so
                the results feel like they're loading, not popping. */}
            <motion.div
              variants={fadeUp}
              className="border-r border-border/50 bg-background/40 p-3"
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Results
              </div>
              <motion.ul
                variants={stagger}
                transition={{ delayChildren: 0.15, staggerChildren: 0.07 }}
                className="flex flex-col gap-1.5"
              >
                {JOB_ROWS.map((row, i) => (
                  <motion.li
                    key={row.title}
                    variants={fadeUp}
                    className={
                      "rounded-lg border border-l-4 px-3 py-2 transition-colors " +
                      (i === activeRow
                        ? "border-l-brand-emerald-500 bg-brand-emerald-50/40"
                        : "border-l-transparent bg-background/60")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={
                          "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider " +
                          TIER_BG[row.tier]
                        }
                      >
                        {row.score}%
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {row.timeAgo}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs font-semibold text-foreground">
                      {row.title}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {row.company} · {row.location}
                    </div>
                  </motion.li>
                ))}
              </motion.ul>
            </motion.div>

            {/* Detail */}
            <motion.div variants={fadeUp} className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Detail
              </div>
              <div className="mt-1 text-base font-semibold text-foreground">
                Sr. Frontend Engineer
              </div>
              <div className="text-xs text-muted-foreground">
                Stripe · San Francisco · Full-time
              </div>

              {/* Score card */}
              <div className="mt-4 rounded-xl border border-brand-emerald-200 bg-brand-emerald-50/60 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-brand-emerald-800">
                    Match score
                  </span>
                  <span className="text-brand-emerald-700">88%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-emerald-100">
                  <motion.div
                    initial={reduced ? { width: "88%" } : { width: 0 }}
                    animate={{ width: "88%" }}
                    transition={{ duration: 1.6, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full rounded-full bg-brand-emerald-600"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {["React", "TypeScript", "Next.js", "A11y"].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-brand-emerald-800 ring-1 ring-brand-emerald-200"
                    >
                      ✓ {tag}
                    </span>
                  ))}
                  <span className="rounded-full bg-[theme(colors.tier-fair-bg)] px-2 py-0.5 text-[10px] font-medium text-[theme(colors.tier-fair-fg)]">
                    — Ruby
                  </span>
                </div>
              </div>

              <ul className="mt-4 flex flex-col gap-1.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-1.5">
                  <CheckCircle2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-emerald-600"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  Added 3 React perf bullets
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-emerald-600"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  Rewrote summary for design-systems fit
                </li>
              </ul>
            </motion.div>
          </motion.div>
        </div>

        {/* Floating callouts */}
        <motion.div
          variants={floatIn(0.8)}
          initial={reduced ? undefined : "hidden"}
          animate="show"
          className="absolute -left-4 top-10 hidden items-center gap-2 rounded-xl border border-border/70 bg-background px-3 py-2 shadow-md md:flex"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-emerald-100 text-brand-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="text-xs">
            <div className="font-semibold text-foreground">{t("floats.skillsMatched")}</div>
            <div className="text-muted-foreground">{t("floats.skillsMatchedDesc")}</div>
          </div>
        </motion.div>

        <motion.div
          variants={floatIn(1.1)}
          initial={reduced ? undefined : "hidden"}
          animate="show"
          className="absolute -right-4 top-32 hidden items-center gap-2 rounded-xl border border-border/70 bg-background px-3 py-2 shadow-md md:flex"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]">
            <Star className="h-4 w-4" aria-hidden />
          </span>
          <div className="text-xs">
            <div className="font-semibold text-foreground">{t("floats.tailored")}</div>
            <div className="text-muted-foreground">{t("floats.tailoredDesc")}</div>
          </div>
        </motion.div>

        <motion.div
          variants={floatIn(1.4)}
          initial={reduced ? undefined : "hidden"}
          animate="show"
          className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-xl border border-border/70 bg-background px-3 py-2 shadow-md md:flex"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-emerald-100 text-brand-emerald-700">
            <MapPin className="h-4 w-4" aria-hidden />
          </span>
          <div className="text-xs">
            <div className="font-semibold text-foreground">{t("floats.roles")}</div>
            <div className="text-muted-foreground">{t("floats.rolesDesc")}</div>
          </div>
        </motion.div>
      </motion.div>
      </motion.div>

    </section>
  );
}
