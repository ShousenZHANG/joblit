"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { revealUp, useReveal } from "./lib/motion";

/**
 * Three questions, because only three real objections exist: price, privacy,
 * and whether anything must be installed. The five-item version this replaces
 * padded the list with restatements of the hero. Answers must stay true to
 * ADR-0015 (no server model keys) and ADR-0022: the copy/paste loop is the
 * product itself, not a degraded fallback for people without a local agent.
 */
const FAQ_KEYS = ["free", "privacy", "byoai"] as const;

export function Faq() {
  const reveal = useReveal();
  const t = useTranslations("landing.faq");

  return (
    <motion.section
      {...reveal}
      id="faq"
      data-testid="landing-faq"
      className="mx-auto w-full max-w-3xl scroll-mt-24 px-6 py-16 sm:px-10 sm:py-24"
      variants={revealUp}
    >
      <h2 className="text-balance text-center text-3xl font-bold tracking-tight text-foreground sm:text-[40px]">
        {t("title")}
      </h2>

      <div className="mt-10 space-y-3">
        {FAQ_KEYS.map((key) => (
          <details
            key={key}
            className="group rounded-2xl border border-border/70 bg-card px-5"
          >
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 [&::-webkit-details-marker]:hidden">
              {t(`items.${key}.q`)}
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <p className="pb-5 text-sm leading-relaxed text-muted-foreground">
              {t(`items.${key}.a`)}
            </p>
          </details>
        ))}
      </div>
    </motion.section>
  );
}
