"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { revealStagger, revealUp, useReveal } from "./lib/motion";

/**
 * The workflow, drawn — four numbered stages, each carrying a miniature of
 * the real product surface for that stage instead of an icon and a slogan.
 *
 * An earlier HowItWorks died for being generic (icons + verbs any SaaS could
 * ship). This one earns its place the same way the bento does: every
 * miniature is recognisable from the actual app — the status segments, the
 * generate button with live progress, the returned PDF chips — so the page
 * shows the loop rather than asserting one exists.
 */

const STEP_KEYS = ["fetch", "triage", "generate", "export"] as const;

/** Shared chip styling for the miniatures — quiet, real, aria-hidden. */
const chip =
  "inline-flex items-center rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-foreground/70";

function StepMini({ step }: { step: (typeof STEP_KEYS)[number] }) {
  switch (step) {
    case "fetch":
      return (
        <div aria-hidden className="flex flex-wrap items-center gap-1">
          <span className={chip}>Platform Engineer</span>
          <span className={chip}>Backend Developer</span>
          <span className="inline-flex items-center rounded-full border border-dashed border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60 line-through">
            duplicate
          </span>
        </div>
      );
    case "triage":
      return (
        <div
          aria-hidden
          className="inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/50 p-0.5"
        >
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
            New
            <span className="rounded-full bg-white/25 px-1 text-[9px] font-bold tabular-nums">
              19
            </span>
          </span>
          <span className="px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            Applied
          </span>
          <span className="px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            Rejected
          </span>
        </div>
      );
    case "generate":
      return (
        <div aria-hidden className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm">
            <Sparkles className="h-3 w-3" />
            AI Generate
          </span>
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
            2 of 5 done
          </span>
        </div>
      );
    case "export":
      return (
        <div aria-hidden className="flex flex-wrap items-center gap-1">
          <span className={chip}>CV — Acme.pdf</span>
          <span className={chip}>Cover — Acme.pdf</span>
        </div>
      );
  }
}

export function Flow() {
  const reveal = useReveal();
  const t = useTranslations("landing.flow");

  return (
    <motion.section
      {...reveal}
      data-testid="landing-flow"
      className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10 sm:py-24"
      variants={revealStagger}
    >
      <motion.p
        variants={revealUp}
        className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-emerald-text"
      >
        {t("kicker")}
      </motion.p>
      <motion.h2
        variants={revealUp}
        className="mt-3 text-balance text-center text-3xl font-bold tracking-tight text-foreground sm:text-[44px] sm:leading-[1.05]"
      >
        {t("titlePrefix")}{" "}
        <em className="font-serif italic">{t("titleItalic")}</em>
      </motion.h2>

      <div className="relative mt-12">
        {/* One continuous rail behind the four stages — the same gradient
            language as the architecture connectors, so the two diagrams read
            as one system. */}
        <div
          aria-hidden
          className="absolute left-8 right-8 top-5 hidden h-px bg-gradient-to-r from-transparent via-brand-emerald-400/50 to-transparent lg:block"
        />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="list">
          {STEP_KEYS.map((key, index) => (
            <motion.li
              key={key}
              variants={revealUp}
              className="relative flex flex-col rounded-2xl border border-border/70 bg-card p-5"
            >
              <span
                aria-hidden
                className="relative z-[1] font-serif text-2xl italic leading-none text-brand-emerald-600/80"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-[15px] font-bold tracking-tight text-foreground">
                {t(`steps.${key}.title`)}
              </h3>
              <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
                {t(`steps.${key}.body`)}
              </p>
              <div className="mt-4 border-t border-border/50 pt-3.5">
                <StepMini step={key} />
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </motion.section>
  );
}
