"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { revealUp, useReveal } from "./lib/motion";

// Capability strip — one quiet line of named, auditable product facts.
//
// The previous version animated counters ("8 job boards", "5 ATS platforms")
// and credited an engine ("Gemini · Skill Pack") that no longer exists in the
// codebase (ADR-0015 removed server-side generation entirely). Counters also
// age badly: every source added or retired turns the page into a liar until
// someone remembers to edit marketing copy.
//
// Names don't lie the way numbers do. Each value is backed by an active
// product boundary: LinkedIn discovery, server-owned AU recall policy, and
// local-first generation. Retired feeds and ATS adapters never appear here.
const CAPABILITY_KEYS = ["intake", "screening", "byom"] as const;

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
        className="mt-8 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-start lg:justify-center lg:gap-x-14"
        role="list"
      >
        {CAPABILITY_KEYS.map((key) => (
          <li key={key} className="flex flex-col items-center text-center">
            <span className="text-base font-bold tracking-tight text-foreground sm:text-lg">
              {t(`items.${key}.value`)}
            </span>
            <span className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">
              {t(`items.${key}.label`)}
            </span>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
