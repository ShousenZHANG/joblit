"use client";

import { useInView, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { fadeUp } from "./lib/motion";
import { useCountUp } from "./lib/useCountUp";

// Stats strip. Dark emerald gradient so it reads as a distinct "product
// metrics" band between the Fetch deep dive and Testimonials. Numbers
// count up on scroll via useCountUp + framer-motion useInView.

interface Stat {
  target: number;
  suffix?: string;
  isFloat?: boolean;
  label: string;
}


function StatCell({ stat, active }: { stat: Stat; active: boolean }) {
  const value = useCountUp({
    target: stat.isFloat ? stat.target * 10 : stat.target,
    durationMs: 1600,
    active,
  });
  const display = stat.isFloat
    ? (value / 10).toFixed(1)
    : Math.round(value).toLocaleString();
  return (
    <div className="text-center">
      <div className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
        {display}
        {stat.suffix ?? ""}
      </div>
      <div className="mt-2 text-xs uppercase tracking-[0.14em] text-white/60 sm:text-sm">
        {stat.label}
      </div>
    </div>
  );
}

export function Stats() {
  const t = useTranslations("landing.stats");
  const STATS: Stat[] = [
    { target: 4281, label: t("applications") },
    {
      target: 4.2,
      suffix: "s",
      isFloat: true,
      label: t("avgTime"),
    },
    { target: 87, suffix: "%", label: t("interviewRate") },
    { target: 6, label: t("boards") },
  ];
  const ref = useRef<HTMLElement | null>(null);
  // Single observer drives both the fade-up reveal on the section
  // chrome and the count-up animation on the numbers inside.
  // amount: 0.25 waits until the band is clearly on-screen so the
  // numbers don't tick past while the user is still scrolling in.
  const inView = useInView(ref, {
    once: true,
    amount: 0.25,
    margin: "0px 0px 15% 0px",
  });

  return (
    <motion.section
      ref={ref}
      data-testid="landing-stats"
      className="mx-auto my-20 w-full max-w-6xl px-6 sm:px-10"
      variants={fadeUp}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
    >
      <div className="grid gap-10 rounded-3xl bg-gradient-to-br from-[#064e3b] via-[#052f24] to-[#022c22] px-8 py-12 text-white sm:grid-cols-2 sm:px-12 sm:py-16 md:grid-cols-4">
        {STATS.map((s) => (
          <StatCell key={s.label} stat={s} active={inView} />
        ))}
      </div>
    </motion.section>
  );
}
