"use client";

import {
  Bolt,
  CheckCircle2,
  FileText,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useSpotlight } from "./lib/interactive";
import { revealUp, revealStagger, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

// Features — 2×2 equal grid, Linear-style. Four REAL differentiators (no
// fabricated "match score" — the product has no scoring feature):
//   1. Experience-gate insight — flags seniority/years gaps per JD
//   2. Trustworthy by design   — ATS-safe + evidence-grounded combined
//   3. Tailored in seconds     — speed
//   4. Pro-grade output        — LaTeX + BYO LLM combined
//
// No hero card, no row hierarchy, no infinite animations. Cards are flat
// surfaces with a single neutral hover lift. Color is reserved for the
// icon chip (subtle emerald gradient) and the kicker line.

interface Feature {
  icon: LucideIcon;
  title: string;
  blurb: string;
}

// Card recipe shared site-wide: rounded-2xl + emerald-tinted hover lift,
// matching HowItWorks and Pricing so the sections read as one designed
// system rather than separately-styled blocks.
const CARD_BASE =
  "spotlight-card group relative flex h-full flex-col rounded-2xl border border-border/60 bg-card p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-brand-emerald-200/70 hover:shadow-[0_18px_36px_-18px_rgba(5,150,105,0.22)] sm:p-8";

/** One feature card — split out so each card owns its pointer-spotlight ref. */
function FeatureCard({ feature }: { feature: Feature }) {
  const spot = useSpotlight<HTMLDivElement>();
  const { icon, title, blurb } = feature;
  return (
    <div ref={spot} className={CARD_BASE}>
      <IconChip icon={icon} />
      <div className="mt-6 text-[19px] font-semibold tracking-tight text-foreground">
        {title}
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        {blurb}
      </p>
    </div>
  );
}

function IconChip({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-emerald-50 to-brand-emerald-100/70 text-brand-emerald-text ring-1 ring-brand-emerald-200/70 transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105"
    >
      <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
    </span>
  );
}

export function Features() {
  const reveal = useReveal();
  const t = useTranslations("landing.features");

  const FEATURES: Feature[] = [
    {
      icon: ShieldAlert,
      title: t("experienceGate.title"),
      blurb: t("experienceGate.blurb"),
    },
    {
      icon: CheckCircle2,
      title: t("trustworthy.title"),
      blurb: t("trustworthy.blurb"),
    },
    {
      icon: Bolt,
      title: t("tailor.title"),
      blurb: t("tailor.blurb"),
    },
    {
      icon: FileText,
      title: t("output.title"),
      blurb: t("output.blurb"),
    },
  ];

  return (
    <motion.section
      {...reveal}
      data-testid="landing-features"
      id="product"
      className="mx-auto w-full max-w-6xl scroll-mt-8 px-6 py-24 sm:px-10"
      variants={revealUp}
    >
      <div className="mb-16 text-center">
        <SectionKicker>{t("kicker")}</SectionKicker>
        <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-[42px] sm:leading-[1.08]">
          {t("titlePrefix")}{" "}
          <em className="font-serif italic text-foreground">
            {t("titleItalic")}
          </em>{" "}
          {t("titleSuffix")}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {t("lede")}
        </p>
      </div>

      <motion.ul
        variants={revealStagger}
        className="grid auto-rows-fr gap-5 md:grid-cols-2"
        role="list"
      >
        {FEATURES.map((feature) => (
          <motion.li key={feature.title} variants={revealUp} className="list-none">
            <FeatureCard feature={feature} />
          </motion.li>
        ))}
      </motion.ul>
    </motion.section>
  );
}
