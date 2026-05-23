"use client";

import { FileEdit, FileText, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { fadeUp, stagger, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

// HowItWorks — 3 numbered steps connected by a faint gradient rail (only
// visible at ≥md). Each step is a surface card with the step number as a
// ring-bordered chip so users can scan the sequence at a glance.

interface Step {
  num: number;
  title: string;
  blurb: string;
  icon: LucideIcon;
}

export function HowItWorks() {
  const reveal = useReveal();
  const t = useTranslations("landing.how");
  const STEPS: Step[] = [
    {
      num: 1,
      title: t("steps.fetch.title"),
      blurb: t("steps.fetch.blurb"),
      icon: Search,
    },
    {
      num: 2,
      title: t("steps.tailor.title"),
      blurb: t("steps.tailor.blurb"),
      icon: FileEdit,
    },
    {
      num: 3,
      title: t("steps.apply.title"),
      blurb: t("steps.apply.blurb"),
      icon: FileText,
    },
  ];
  return (
    <motion.section
      {...reveal}
      data-testid="landing-howitworks"
      id="how"
      className="mx-auto w-full max-w-6xl px-6 py-24 sm:px-10"
      variants={fadeUp}
    >
      <div className="mb-14 text-center">
        <SectionKicker>{t("kicker")}</SectionKicker>
        <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t("titlePrefix")}{" "}
          <em className="font-serif italic text-foreground">
            {t("titleItalic")}
          </em>
          {t("titleSuffix")}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {t("lede")}
        </p>
      </div>

      <motion.ol
        variants={stagger}
        className="relative grid gap-8 md:grid-cols-3"
      >
        {/* Connecting rail — static gradient line, no animation. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-12 hidden h-px bg-gradient-to-r from-transparent via-brand-emerald-500/40 to-transparent md:block"
        />

        {STEPS.map(({ num, title, blurb, icon: Icon }) => (
          <motion.li
            key={num}
            variants={fadeUp}
            className="group relative flex flex-col rounded-2xl border border-border/60 bg-card p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-brand-emerald-200/70 hover:shadow-[0_18px_36px_-18px_rgba(5,150,105,0.22)]"
          >
            <div className="mb-5 flex items-center gap-3">
              <span
                aria-hidden
                className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-emerald-500 to-brand-emerald-600 text-sm font-bold text-white shadow-[0_6px_16px_-4px_rgba(5,150,105,0.45)] ring-4 ring-brand-emerald-50 transition-transform duration-300 group-hover:scale-105"
              >
                {num}
              </span>
              <Icon
                className="h-5 w-5 text-brand-emerald-600/80 transition-colors duration-300 group-hover:text-brand-emerald-700"
                strokeWidth={1.8}
                aria-hidden
              />
            </div>
            <div className="text-[17px] font-semibold tracking-tight text-foreground">
              {title}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {blurb}
            </p>
          </motion.li>
        ))}
      </motion.ol>
    </motion.section>
  );
}
