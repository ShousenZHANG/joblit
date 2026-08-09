"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { FileCheck2, MousePointerClick } from "lucide-react";
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
 * - Delta tailoring: summary + max three added bullets — the strict output
 *   contract in the prompt schema.
 * - Local-first: the Runner drives the user's own Codex CLI (ADR-0015/0018);
 *   the command shown is the real one.
 * - "Nothing runs twice": receipt-backed settlement (AGENTS.md contract) —
 *   plain-language framing of content-addressed replay.
 */

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

        {/* Delta tailoring — the strict output contract, drawn */}
        <BentoCell>
          <CellHeading title={t("deltaTitle")} body={t("deltaBody")} />
          <div className="mt-4 space-y-1.5 text-xs" aria-hidden>
            <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-1.5 text-muted-foreground">
              Led the platform migration to Kubernetes…
            </div>
            <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-1.5 text-muted-foreground">
              Cut CI feedback time by 60%…
            </div>
            <div className="rounded-lg border border-brand-emerald-300/60 bg-brand-emerald-50/70 px-3 py-1.5 font-medium text-brand-emerald-800 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300">
              + Shipped observability for 40+ services…
            </div>
          </div>
        </BentoCell>

        {/* Local-first — the Runner, as it actually looks */}
        <BentoCell>
          <CellHeading title={t("localTitle")} body={t("localBody")} />
          <pre
            aria-hidden
            className="mt-4 overflow-x-auto rounded-lg border border-border/60 bg-foreground/[0.03] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground dark:bg-background/60"
          >
{`$ node tools/runner/cli.mjs --watch
✓ Resume tailored — saved to your workspace
✓ Cover letter — saved`}
          </pre>
        </BentoCell>

        {/* Receipts — settlement, not retries */}
        <BentoCell>
          <CellHeading title={t("receiptsTitle")} body={t("receiptsBody")} />
          <div
            aria-hidden
            className="mt-4 flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2.5"
          >
            <FileCheck2 className="h-4 w-4 shrink-0 text-brand-emerald-600" />
            <span className="truncate text-[11px] font-medium text-muted-foreground">
              {t("receiptsSaved")}
            </span>
            <span className="ml-auto shrink-0 rounded-full bg-brand-emerald-100/80 px-2 py-0.5 text-[10px] font-bold text-brand-emerald-800 dark:bg-brand-emerald-500/15 dark:text-brand-emerald-300">
              {t("receiptsBadge")}
            </span>
          </div>
        </BentoCell>
      </div>
    </motion.section>
  );
}
