"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { CountUp } from "./lib/interactive";
import { revealUp, useReveal } from "./lib/motion";

// Capability strip — replaces the old fake text-wordmark "social proof"
// (rendering "Stripe"/"Linear" in our own font implied false endorsement
// and read as a skeleton-loading state). These are honest, verifiable
// product facts that double as the integration story. Stats are universal
// (numbers / product names); the labels translate.

const CAPABILITY_STATS = ["8", "5", "Gemini · Skill Pack", "EN · 中文"] as const;
const CAPABILITY_KEYS = ["boards", "ats", "byom", "bilingual"] as const;

export function LogoBar() {
  const reveal = useReveal();
  const t = useTranslations("landing.logoBar");
  return (
    <motion.section
      {...reveal}
      data-testid="landing-logobar"
      className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-10 sm:py-16"
      variants={revealUp}
    >
      <h2 className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {t("heading")}
      </h2>
      <ul
        className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 sm:flex sm:flex-wrap sm:items-start sm:justify-center sm:gap-x-14"
        role="list"
      >
        {CAPABILITY_KEYS.map((key, i) => {
          const stat = CAPABILITY_STATS[i];
          const numeric = /^\d+$/.test(stat);
          return (
            <li key={key} className="flex flex-col items-center text-center">
              <span className="text-2xl font-bold tracking-tight text-foreground sm:text-[26px]">
                {/* Real numbers tick up once on first view; non-numeric stats
                    (model names, locales) stay static. */}
                {numeric ? (
                  <>
                    <span aria-hidden="true">
                      <CountUp to={Number(stat)} />
                    </span>
                    <span className="sr-only">{stat}</span>
                  </>
                ) : stat}
              </span>
              <span className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">
                {t(`items.${key}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
