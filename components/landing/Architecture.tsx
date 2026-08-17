"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { FileCheck2, Lock, MessagesSquare, ShieldCheck } from "lucide-react";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { revealUp, useReveal } from "./lib/motion";

/**
 * The signature section: the honest loop, drawn.
 *
 * No other job-search product can draw this diagram, because no other one is
 * built this way — Joblit's servers hold no model key and cannot call a model
 * (ADR-0015). Generation is the paste loop itself (ADR-0022): the workspace
 * builds the exact prompt, the visitor's own chatbot writes, and what comes
 * back must clear deterministic gates — summary lint and skill-index
 * resolution (ADR-0023) — before Finalize renders the one PDF. The dashed
 * boundary encloses only the chatbot: that is the piece Joblit never sees.
 *
 * Every sentence here is auditable against the repository, which makes this
 * section load-bearing: retiring or reshaping any of these four stages must
 * update this diagram in the same change, or the landing page starts lying.
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
      id="architecture"
      data-testid="landing-architecture"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-16 sm:px-10 sm:py-24"
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
          instead of dead space. The boundary node gets a little extra width
          because it also carries the lock caption — the section's claim. */}
      <div className="mt-12 flex flex-col items-stretch gap-0 lg:flex-row lg:items-stretch lg:gap-5">
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

        {/* Your chatbot — the boundary. Only this node sits inside the dashed
            box: the prompt goes in and the JSON comes out by the visitor's
            own hand, so the account behind it is invisible to Joblit. */}
        <div className="relative flex flex-[1.2] flex-col justify-center rounded-2xl border-2 border-dashed border-brand-emerald-400/60 bg-brand-emerald-50/30 p-6 pt-7 shadow-[0_0_40px_-18px_rgba(16,185,129,0.45)] dark:bg-brand-emerald-500/[0.06]">
          <span className="absolute -top-3 left-6 rounded-full border border-brand-emerald-300 bg-background px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-emerald-text">
            {t("boundaryLabel")}
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-card ring-1 ring-border/70">
            <MessagesSquare
              className="h-[18px] w-[18px] text-brand-emerald-600"
              aria-hidden
            />
          </span>
          <h3 className="mt-3 text-[15px] font-bold tracking-tight text-foreground">
            {t("chatbotTitle")}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t("chatbotDesc")}
          </p>
          <div className="mt-4 flex items-start gap-2 border-t border-brand-emerald-400/25 pt-4">
            <Lock
              className="mt-px h-3.5 w-3.5 shrink-0 text-brand-emerald-700 dark:text-brand-emerald-300"
              aria-hidden
            />
            <p className="text-xs font-semibold leading-relaxed text-brand-emerald-800 dark:text-brand-emerald-300">
              {t("boundaryCaption")}
            </p>
          </div>
        </div>

        <FlowConnector />
        <FlowConnector vertical />

        {/* Deterministic gates */}
        <div className="flex flex-1 flex-col justify-center rounded-2xl border border-border/70 bg-card p-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
            <ShieldCheck
              className="h-[18px] w-[18px] text-brand-emerald-text"
              aria-hidden
            />
          </span>
          <h3 className="mt-3 text-[15px] font-bold tracking-tight text-foreground">
            {t("gatesTitle")}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t("gatesDesc")}
          </p>
        </div>

        <FlowConnector />
        <FlowConnector vertical />

        {/* PDF */}
        <div className="flex flex-1 flex-col justify-center rounded-2xl border border-border/70 bg-card p-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
            <FileCheck2
              className="h-[18px] w-[18px] text-muted-foreground"
              aria-hidden
            />
          </span>
          <h3 className="mt-3 text-[15px] font-bold tracking-tight text-foreground">
            {t("pdfTitle")}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t("pdfDesc")}
          </p>
        </div>
      </div>
    </motion.section>
  );
}
