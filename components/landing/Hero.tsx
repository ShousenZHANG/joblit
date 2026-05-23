"use client";

import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Play,
  Search,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useState } from "react";
import { fadeUp, stagger } from "./lib/motion";
import { useCtaHref } from "./lib/useCtaHref";

// Run a layout effect on the client, noop on the server, so we can
// flip the mount flag before first paint (React would log a warning
// if we used useLayoutEffect unconditionally during SSR).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Hero — Linear/Vercel pattern: centered headline, dual CTA, full-width
// product mock as the visual anchor. Sections:
//   1. Eyebrow + pulsing green dot.
//   2. Hero title (huge, two lines, italic serif emphasis on second line).
//   3. Subtitle.
//   4. Dual CTA — primary "Start free" + secondary "Watch demo".
//   5. Meta — "Free forever · Bring your own LLM key".
//   6. Hero canvas: 3-column product mock (sidebar + job list + detail).
//      Score bar fills 0 → 88% on enter view. Active job row rotates
//      every 2.6s so the demo feels alive.
//
// Floating callouts ("Skills matched / Tailored / Roles found") have been
// removed — they distracted from the mock itself and the value they
// signaled is already visible inside the mock's detail panel.
//
// All infinite CSS animations on this section have been removed (no more
// landing-scanline / landing-depth-lift / landing-dynamic-frame). The
// only motion that runs at steady state is the eyebrow dot pulse.

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
  const cta = useCtaHref();
  // Two-phase mount: SSR paints the hidden state (opacity 0 / y 40),
  // then the layout effect flips `mounted` true on the first client
  // frame so framer-motion runs a real transition from hidden → show.
  // Without this, framer-motion sees `animate="show"` during hydration
  // and skips the tween — the user sees the final state instantly on
  // fast connections, which reads as "no animation".
  const [mounted, setMounted] = useState(false);
  useIsomorphicLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

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
        show: { opacity: 1, transition: { duration: 0.3 } },
      }
    : {
        hidden: { opacity: 0, y: 24 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
        },
      };

  return (
    <section
      data-testid="landing-hero"
      className="relative isolate mx-auto w-full max-w-6xl overflow-hidden px-6 pb-24 pt-16 sm:pt-24 lg:px-10"
    >
      <div
        aria-hidden
        className="landing-canvas-grid pointer-events-none absolute inset-x-0 top-10 -z-10 h-[620px] opacity-80"
      />
      <motion.div
        variants={introStagger}
        initial="hidden"
        animate={mounted ? "show" : "hidden"}
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

      {/* Title — Linear-style oversized headline. lg:text-[88px] is the
          Vercel/Linear visual baseline; tracking-tight + leading-[0.95]
          collapses the line gap so the two lines feel like one display
          block. */}
      <motion.h1
        variants={introItem}
        className="mx-auto mt-6 max-w-[21rem] text-balance text-center text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:max-w-3xl sm:text-6xl sm:leading-[1] lg:max-w-4xl lg:text-[88px] lg:leading-[0.95]"
      >
        {t("titleLine1")}
        <br />
        <em className="font-serif italic text-foreground">
          {t("titleItalic")}
        </em>
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        variants={introItem}
        className="mx-auto mt-6 max-w-[21rem] text-balance text-center text-base leading-relaxed text-muted-foreground sm:max-w-2xl sm:text-lg"
      >
        {t("subtitle")}
      </motion.p>

      {/* CTA */}
      <motion.div
        variants={introItem}
        className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
      >
        <Link
          href={cta.href}
          aria-disabled={cta.disabled}
          tabIndex={cta.disabled ? -1 : undefined}
          className={
            "inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background transition-transform hover:-translate-y-px hover:bg-foreground/90 " +
            (cta.disabled ? "pointer-events-none opacity-70" : "")
          }
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

      {/* Meta — single honest line, no fabricated counters. */}
      <motion.div
        variants={introItem}
        className="mt-6 flex items-center justify-center text-xs text-muted-foreground"
      >
        <span>{t("metaFree")}</span>
      </motion.div>

      {/* Canvas — frame lifts in with a single rise + scale settle, no
          infinite floating animation behind it. */}
      <motion.div
        variants={{
          hidden: reduced
            ? { opacity: 0 }
            : { opacity: 0, y: 48, scale: 0.985 },
          show: {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: {
              duration: 0.7,
              ease: [0.16, 1, 0.3, 1] as const,
            },
          },
        }}
        className="relative mx-auto mt-16 max-w-5xl"
      >
        {/* Static emerald glow behind the canvas — gives lift without an
            animated shadow. Pointer-events-none + -z-10 so it never
            interferes with mock interactions. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-6 -bottom-8 -z-10 h-72 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(16,185,129,0.12),transparent_70%)]"
        />
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[0_30px_80px_-30px_rgba(15,23,42,0.18)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-brand-emerald-400/60 to-transparent"
          />
          {/* App mock: phones get a single stacked column; ≥sm gets
              list + detail (sidebar hidden); ≥md gets the full 3-col.
              Columns mount with a 90/130/170 ms cascade after the
              canvas frame lifts in, so the product mock reads as
              "assembling itself" rather than snapping into place. */}
          <motion.div
            variants={stagger}
            initial={reduced ? undefined : "hidden"}
            animate={mounted ? "show" : reduced ? undefined : "hidden"}
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
                        ? "border-l-brand-emerald-500 bg-brand-emerald-50/40 shadow-[0_12px_30px_-24px_rgba(5,150,105,0.55)]"
                        : "border-l-transparent bg-background/60")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        {i === activeRow && (
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full bg-brand-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]"
                          />
                        )}
                        <span
                          className={
                            "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider " +
                            TIER_BG[row.tier]
                          }
                        >
                          {row.score}%
                        </span>
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
                    transition={{ duration: 1.4, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
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

      </motion.div>
      </motion.div>

    </section>
  );
}
