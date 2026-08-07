"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Cpu, FileCheck2, Lock, TerminalSquare } from "lucide-react";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { ClaudeMark, OpenAiMark } from "./brandMarks";
import { revealUp, useReveal } from "./lib/motion";

/**
 * The signature section: the local-first pipeline, drawn.
 *
 * No other job-search product can draw this diagram, because no other one is
 * built this way — Joblit's servers hold no model key and cannot call a model
 * (ADR-0015). The glowing boundary is the claim: every model call happens
 * inside the visitor's own machine, over loopback, on their own subscription,
 * through OpenAI's official Codex app-server (the bootstrap enforces that
 * runtime). Every sentence here is auditable against the repository.
 *
 * Brand marks (OpenAI, Claude) are nominative "works with" usage — see
 * brandMarks.tsx. Hermes deliberately gets a wordmark, not an invented icon:
 * Nous Research ships no clean official vector.
 */

function FlowConnector({ vertical = false }: { vertical?: boolean }) {
  return (
    <div
      aria-hidden
      className={
        vertical
          ? "relative mx-auto h-10 w-px bg-gradient-to-b from-border via-brand-emerald-400/60 to-border lg:hidden"
          : "relative hidden h-px flex-1 self-center bg-gradient-to-r from-border via-brand-emerald-400/60 to-border lg:block"
      }
    >
      <span
        className={
          vertical
            ? "landing-flow-dot absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-brand-emerald-500 motion-reduce:hidden"
            : "landing-flow-dot-x absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand-emerald-500 motion-reduce:hidden"
        }
      />
    </div>
  );
}

export function Architecture() {
  const reveal = useReveal();
  const t = useTranslations("landing.architecture");

  return (
    <motion.section
      {...reveal}
      data-testid="landing-architecture"
      className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10 sm:py-24"
      variants={revealUp}
    >
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-emerald-text">
        {t("kicker")}
      </p>
      <h2 className="mt-3 text-balance text-center text-3xl font-bold tracking-tight text-foreground sm:text-[44px] sm:leading-[1.05]">
        {t("titlePrefix")}{" "}
        <em className="font-serif italic">{t("titleItalic")}</em>
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-muted-foreground">
        {t("lede")}
      </p>

      {/* Composition notes: every node vertically centres its content, so
          the stretch-to-tallest column reads as intentional breathing room
          instead of dead space at the bottom of the boundary box. The
          subscription label owns its line and the brand marks are pills —
          the row can never wrap into a ragged orphan. */}
      <div className="mt-12 flex flex-col items-stretch gap-0 lg:flex-row lg:items-stretch lg:gap-6">
        {/* Joblit workspace */}
        <div className="flex flex-1 flex-col justify-center rounded-2xl border border-border/70 bg-card p-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background">
            <JoblitMark size={17} ariaLabel={null} />
          </span>
          <h3 className="mt-3 text-[15px] font-bold tracking-tight text-foreground">
            {t("workspaceTitle")}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t("workspaceDesc")}
          </p>
        </div>

        <FlowConnector />
        <FlowConnector vertical />

        {/* Your machine — the boundary */}
        <div className="relative flex flex-[1.35] flex-col justify-center rounded-2xl border-2 border-dashed border-brand-emerald-400/60 bg-brand-emerald-50/30 p-6 pt-7 shadow-[0_0_40px_-18px_rgba(16,185,129,0.45)] dark:bg-brand-emerald-500/[0.06]">
          <span className="absolute -top-3 left-6 rounded-full border border-brand-emerald-300 bg-background px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-emerald-text">
            {t("machineLabel")}
          </span>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <TerminalSquare className="h-[18px] w-[18px] shrink-0 text-brand-emerald-600" aria-hidden />
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-foreground">Runner</div>
                <div className="text-[11px] leading-snug text-muted-foreground">
                  {t("runnerDesc")}
                </div>
              </div>
            </div>
            <span
              aria-hidden
              className="hidden text-base font-semibold text-brand-emerald-600 sm:block"
            >
              →
            </span>
            <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <Cpu className="h-[18px] w-[18px] shrink-0 text-brand-emerald-600" aria-hidden />
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-foreground">Hermes</div>
                <div className="text-[11px] leading-snug text-muted-foreground">
                  {t("hermesDesc")}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 border-t border-brand-emerald-400/25 pt-4">
            <Lock
              className="mt-px h-3.5 w-3.5 shrink-0 text-brand-emerald-700 dark:text-brand-emerald-300"
              aria-hidden
            />
            <p className="text-xs font-semibold leading-relaxed text-brand-emerald-800 dark:text-brand-emerald-300">
              {t("boundaryNote")}
            </p>
          </div>
          {/* Nominative "works with" marks — the subscriptions Hermes can
              drive, named so a non-technical visitor recognises them. */}
          <div className="mt-4">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("subscriptionLabel")}
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-semibold text-foreground">
                <OpenAiMark className="h-4 w-4" />
                ChatGPT
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-semibold text-foreground">
                <ClaudeMark className="h-4 w-4" />
                Claude
              </span>
            </div>
          </div>
        </div>

        <FlowConnector />
        <FlowConnector vertical />

        {/* Drafts back */}
        <div className="flex flex-1 flex-col justify-center rounded-2xl border border-border/70 bg-card p-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
            <FileCheck2 className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
          </span>
          <h3 className="mt-3 text-[15px] font-bold tracking-tight text-foreground">
            {t("draftsTitle")}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t("draftsDesc")}
          </p>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        {t("poweredByPrefix")}{" "}
        <a
          href="https://github.com/NousResearch/hermes-agent"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-foreground underline-offset-2 hover:underline"
        >
          Hermes
        </a>{" "}
        {t("poweredBySuffix")}
      </p>
    </motion.section>
  );
}
