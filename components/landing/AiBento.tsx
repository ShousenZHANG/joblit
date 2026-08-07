"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  MinusCircle,
  ReceiptText,
  XCircle,
} from "lucide-react";
import { useSpotlight } from "./lib/interactive";
import { revealStagger, revealUp, useReveal } from "./lib/motion";
import { cn } from "@/lib/utils";

/**
 * The AI story as a bento grid — each cell leads with a miniature of the
 * real product surface instead of an icon and a slogan, and every claim is
 * auditable:
 *
 * - Evidence-gated fit: the model emits judgements only; scores are
 *   aggregated deterministically (lib/server/ai/fitScoring) and ungrounded
 *   claims are rejected by the evidence gate.
 * - Delta tailoring: a summary plus at most three added bullets — the strict
 *   output contract in the prompt schema.
 * - Local-first: the Runner drives Hermes over loopback (ADR-0014/0015).
 * - Receipts: content-addressed settlement; a crash replays the receipt,
 *   never the model call (AGENTS.md fit-settlement contract).
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
        {/* Evidence-gated fit — miniature of the real judgement chips */}
        <BentoCell>
          <CellHeading title={t("fitTitle")} body={t("fitBody")} />
          <div className="mt-4 flex flex-wrap gap-1.5" aria-hidden>
            <span className="inline-flex items-center gap-1 rounded-full border border-brand-emerald-200 bg-brand-emerald-50 px-2.5 py-1 text-xs font-medium text-brand-emerald-800 dark:border-brand-emerald-500/30 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-300">
              Kubernetes
              <CheckCircle2 className="h-3 w-3" />
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
              GraphQL
              <MinusCircle className="h-3 w-3" />
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/70 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">
              Rust
              <XCircle className="h-3 w-3" />
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
Working batch 4f2a…
  resume: imported
  cover: imported`}
          </pre>
        </BentoCell>

        {/* Receipts — settlement, not retries */}
        <BentoCell>
          <CellHeading title={t("receiptsTitle")} body={t("receiptsBody")} />
          <div
            aria-hidden
            className="mt-4 flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2.5"
          >
            <ReceiptText className="h-4 w-4 shrink-0 text-brand-emerald-600" />
            <code className="truncate font-mono text-[11px] text-muted-foreground">
              issueKey d41f…9c2e
            </code>
            <span className="ml-auto shrink-0 rounded-full bg-brand-emerald-100/80 px-2 py-0.5 text-[10px] font-bold text-brand-emerald-800 dark:bg-brand-emerald-500/15 dark:text-brand-emerald-300">
              {t("receiptsSettled")}
            </span>
          </div>
        </BentoCell>
      </div>
    </motion.section>
  );
}
