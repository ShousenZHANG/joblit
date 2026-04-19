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
          <em className="font-serif italic text-brand-emerald-700">
            {t("titleItalic")}
          </em>
          {t("titleSuffix")}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
          {t("lede")}
        </p>
      </div>

      <motion.ol
        variants={stagger}
        className="relative grid gap-8 md:grid-cols-3"
      >
        {/* Connecting rail */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-12 hidden h-px bg-gradient-to-r from-transparent via-brand-emerald-500/40 to-transparent md:block"
        />

        {STEPS.map(({ num, title, blurb, icon: Icon }) => (
          <motion.li
            key={num}
            variants={fadeUp}
            className="relative flex flex-col rounded-2xl border border-border/60 bg-background p-6 shadow-sm"
          >
            <div className="mb-4 flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-brand-emerald-500 bg-background text-sm font-bold text-brand-emerald-700"
                aria-hidden
              >
                {num}
              </span>
              <Icon
                className="h-5 w-5 text-brand-emerald-600"
                strokeWidth={1.8}
                aria-hidden
              />
            </div>
            <div className="text-lg font-semibold text-foreground">
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
