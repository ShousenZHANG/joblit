"use client";

import {
  CheckCircle2,
  Clock,
  FileText,
  Link2,
  MapPin,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { fadeUp, stagger, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

// Features — editorial bento grid.
//
// Row 1 (hero): `Match scoring` occupies full width as a banner-style
// card with an inline score-bar flourish. This is the anchor feature —
// the one thing Joblit owns and the one a visitor will remember.
//
// Row 2: three equal cards covering the differentiators that make the
// match score trustworthy (ATS-safe, Evidence-grounded, 4-second tailor).
//
// Row 3: two equal cards covering the craft / flexibility angles
// (LaTeX PDFs, BYO LLM).
//
// Heights align on each row so the eye can rest on a clean baseline;
// the hero card breaks the rhythm on row 1 and carries extra visual
// weight via its emerald gradient + inline mini-visual.

interface Feature {
  icon: LucideIcon;
  title: string;
  blurb: string;
}

const SECONDARY: Feature[] = [
  {
    icon: CheckCircle2,
    title: "ATS-safe",
    blurb:
      "Output parses cleanly through Workday, Greenhouse, Lever, iCIMS — no recruiter sees a garbled file.",
  },
  {
    icon: Star,
    title: "Evidence-grounded",
    blurb:
      "Every bullet cites a real line from your past experience. Zero hallucinated claims, ever.",
  },
  {
    icon: Clock,
    title: "4-second tailor",
    blurb:
      "Streamed generation — watch the resume compose itself in real time, no loading spinners.",
  },
];

const TERTIARY: Feature[] = [
  {
    icon: FileText,
    title: "LaTeX-quality PDFs",
    blurb:
      "Typeset output with proper kerning, widow control, and typography — not a Word doc in disguise. EN or CN.",
  },
  {
    icon: Link2,
    title: "Bring your own LLM",
    blurb:
      "Use Joblit's inference, or plug in your own Gemini / Claude / OpenAI key. Your cost, your latency, your choice.",
  },
];

/** Standard card chrome shared by hero and grid cards. */
const CARD_BASE =
  "group relative flex flex-col rounded-3xl border border-border/60 bg-background/80 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-brand-emerald-200 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_36px_-14px_rgba(5,150,105,0.22)]";

function IconChip({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-emerald-50 to-brand-emerald-100/70 text-brand-emerald-700 ring-1 ring-brand-emerald-200/70 transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105"
    >
      <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
    </span>
  );
}

/**
 * Inline mini score-bar displayed only on the hero card. Four vertical
 * pills with decreasing heights create a tiny data-viz flourish that
 * signals "this is the scoring feature" without needing a chart library.
 */
function ScoreGlyph() {
  return (
    <div
      aria-hidden
      className="flex items-end gap-1"
    >
      {[65, 82, 92, 74].map((v, i) => (
        <span
          key={i}
          className="w-1.5 rounded-full bg-gradient-to-t from-brand-emerald-500 to-brand-emerald-300"
          style={{ height: `${v / 4}px` }}
        />
      ))}
    </div>
  );
}

export function Features() {
  const reveal = useReveal();
  return (
    <motion.section
      {...reveal}
      data-testid="landing-features"
      id="product"
      className="mx-auto w-full max-w-6xl px-6 py-24 sm:px-10"
      variants={fadeUp}
    >
      <div className="mb-16 text-center">
        <SectionKicker>Why Joblit</SectionKicker>
        <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-[42px] sm:leading-[1.08]">
          Built for the{" "}
          <em className="font-serif italic text-brand-emerald-700">
            signal-to-noise
          </em>{" "}
          problem.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Every feature shaves friction off a real step of the hunt — not
          nice-to-haves, table stakes for job seekers in 2026.
        </p>
      </div>

      <motion.ul
        variants={stagger}
        className="grid auto-rows-fr gap-5"
        role="list"
      >
        {/* Hero row — Match scoring */}
        <motion.li variants={fadeUp} className="list-none">
          <div
            className={
              CARD_BASE +
              " overflow-hidden bg-gradient-to-br from-brand-emerald-50/80 via-background to-background p-8 sm:p-10"
            }
          >
            {/* Decorative corner glow — aids the "hero" emphasis without
                a separate image asset. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-brand-emerald-200/40 to-transparent blur-2xl"
            />
            <div className="relative flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
              <IconChip icon={MapPin} />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                    Match scoring, honest
                  </h3>
                  <span className="inline-flex items-center gap-2 rounded-full border border-brand-emerald-200/70 bg-background/70 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-brand-emerald-700">
                    <ScoreGlyph />
                    0–100 rubric
                  </span>
                </div>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                  Every JD is parsed and scored against your profile on a
                  0–100 scale. See exactly which skills match, which
                  don&apos;t, and what to do about the gaps. No inflated
                  numbers. No gamification. Just a published rubric you can
                  argue with.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-[12px]">
                  {[
                    "Skill coverage",
                    "Seniority fit",
                    "Years of experience",
                    "Domain overlap",
                  ].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-brand-emerald-50 px-2.5 py-1 font-medium text-brand-emerald-700 ring-1 ring-brand-emerald-100"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.li>

        {/* Row 2 — three equal differentiators */}
        <motion.li variants={fadeUp} className="list-none">
          <ul className="grid gap-5 md:grid-cols-3" role="list">
            {SECONDARY.map(({ icon, title, blurb }) => (
              <motion.li
                key={title}
                variants={fadeUp}
                className={CARD_BASE}
              >
                <IconChip icon={icon} />
                <div className="mt-5 text-[17px] font-semibold tracking-tight text-foreground">
                  {title}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {blurb}
                </p>
              </motion.li>
            ))}
          </ul>
        </motion.li>

        {/* Row 3 — two craft/flex cards */}
        <motion.li variants={fadeUp} className="list-none">
          <ul className="grid gap-5 md:grid-cols-2" role="list">
            {TERTIARY.map(({ icon, title, blurb }) => (
              <motion.li
                key={title}
                variants={fadeUp}
                className={CARD_BASE}
              >
                <IconChip icon={icon} />
                <div className="mt-5 text-[17px] font-semibold tracking-tight text-foreground">
                  {title}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {blurb}
                </p>
              </motion.li>
            ))}
          </ul>
        </motion.li>
      </motion.ul>
    </motion.section>
  );
}
