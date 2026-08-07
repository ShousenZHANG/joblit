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
// Names don't lie the way numbers do. Each value below is verifiable against
// the repository: the intake pipeline (LinkedIn via the JobSpy worker plus
// curated feed and ATS-tenant adapters), the four supported ATS providers
// (lib/server/sources/atsBoards.ts), local-first generation (ADR-0015), and
// the bilingual LaTeX renderers.
const CAPABILITY_VALUES = [
  "LinkedIn + curated sources",
  "Greenhouse · Lever · Ashby · Workable",
  "Your own AI — on your machine",
] as const;
const CAPABILITY_KEYS = ["boards", "ats", "byom"] as const;

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
        {CAPABILITY_KEYS.map((key, i) => (
          <li key={key} className="flex flex-col items-center text-center">
            <span className="text-base font-bold tracking-tight text-foreground sm:text-lg">
              {CAPABILITY_VALUES[i]}
            </span>
            <span className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">
              {t(`items.${key}`)}
            </span>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
