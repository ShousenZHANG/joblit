"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Check, FlaskConical, Github, KeyRound, MousePointerClick } from "lucide-react";
import { useSpotlight } from "./lib/interactive";
import { revealStagger, revealUp, useReveal } from "./lib/motion";
import { cn } from "@/lib/utils";

/**
 * The AI story as a bento grid — each cell leads with a miniature of the
 * real product surface instead of an icon and a slogan. The copy is written
 * for a non-technical reader, but every claim still maps to a mechanism:
 *
 * - Fine print: the JD requirements analysis (lib/shared/jobExperienceAnalysis)
 *   extracts hard asks with evidence offsets; every chip jumps to the sentence.
 * - Summary gate: summaryLint (lib/server/ai/summaryLint.ts, ADR-0023) runs
 *   three checks at import — role named, numbers grounded, skills grounded.
 * - Index-reference skills: the model returns {group, items} positions into
 *   the user's own skill bank; an unresolvable index is rejected (ADR-0023).
 * - Proof: open source, the test count, and the no-server-model-keys
 *   architecture (ADR-0015) — verifiable, not aspirational.
 */

const GITHUB_REPO_URL = "https://github.com/ShousenZHANG/joblit";

function BentoCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const spot = useSpotlight<HTMLDivElement>();
  return (
    <motion.div
      variants={revealUp}
      ref={spot}
      className={cn(
        "spotlight-card relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

function CellHeading({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
    </>
  );
}

/** One green tick + label row in the summary-gate miniature. */
function GateCheckRow({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
      <Check className="h-3 w-3 shrink-0 text-brand-emerald-600" aria-hidden />
      {label}
    </li>
  );
}

export function AiBento() {
  const reveal = useReveal();
  const t = useTranslations("landing.bento");

  return (
    <motion.section
      {...reveal}
      data-testid="landing-bento"
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

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {/* JD fine print — miniature of the real requirement chips */}
        <BentoCell>
          <CellHeading
            title={t("requirementsTitle")}
            body={t("requirementsBody")}
          />
          <div className="mt-4 flex flex-wrap items-center gap-1.5" aria-hidden>
            <span className="inline-flex items-center rounded-full border border-brand-blue/30 bg-brand-blue/5 px-2.5 py-1 text-xs font-medium text-brand-blue">
              8+ yrs Java
            </span>
            <span className="inline-flex items-center rounded-full border border-brand-blue/30 bg-brand-blue/5 px-2.5 py-1 text-xs font-medium text-brand-blue">
              NV1 clearance
            </span>
            <span className="inline-flex items-center rounded-full border border-brand-blue/30 bg-brand-blue/5 px-2.5 py-1 text-xs font-medium text-brand-blue">
              Citizens/PR only
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <MousePointerClick className="h-3 w-3" />
              View in JD
            </span>
          </div>
        </BentoCell>

        {/* Summary gate — the three summaryLint checks, drawn */}
        <BentoCell>
          <CellHeading title={t("summaryTitle")} body={t("summaryBody")} />
          <div className="mt-4 space-y-2" aria-hidden>
            <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-1.5 text-xs italic text-muted-foreground">
              “Frontend engineer with 6 years building accessible design
              systems…”
            </div>
            <ul className="space-y-1">
              <GateCheckRow label={t("summaryCheckRole")} />
              <GateCheckRow label={t("summaryCheckNumbers")} />
              <GateCheckRow label={t("summaryCheckSkills")} />
            </ul>
          </div>
        </BentoCell>

        {/* Index-reference skills — positions in, names never */}
        <BentoCell>
          <CellHeading title={t("indexTitle")} body={t("indexBody")} />
          <div
            aria-hidden
            className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <pre className="shrink-0 overflow-x-auto rounded-lg border border-border/60 bg-foreground/[0.03] px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground dark:bg-background/60">
{`{ "group": 1, "items": [2, 0] }`}
            </pre>
            <div className="flex flex-wrap items-center gap-1">
              <span className="rounded-full bg-brand-emerald-100/80 px-2 py-0.5 text-[10px] font-bold text-brand-emerald-800 dark:bg-brand-emerald-500/15 dark:text-brand-emerald-300">
                TypeScript
              </span>
              <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                GraphQL
              </span>
              <span className="rounded-full bg-brand-emerald-100/80 px-2 py-0.5 text-[10px] font-bold text-brand-emerald-800 dark:bg-brand-emerald-500/15 dark:text-brand-emerald-300">
                React
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {t("indexCaption")}
          </p>
        </BentoCell>

        {/* Proof — verifiable facts, not adjectives. The GitHub row is a real
            link, so this miniature is content, not decoration. */}
        <BentoCell>
          <CellHeading title={t("proofTitle")} body={t("proofBody")} />
          <ul className="mt-4 space-y-2 text-xs font-medium text-foreground/80">
            <li className="flex items-center gap-2">
              <Github className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600" aria-hidden />
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t("proofOpenSource")}
              </a>
            </li>
            <li className="flex items-center gap-2">
              <FlaskConical className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600" aria-hidden />
              {t("proofTests")}
            </li>
            <li className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600" aria-hidden />
              {t("proofNoKeys")}
            </li>
          </ul>
        </BentoCell>
      </div>
    </motion.section>
  );
}
