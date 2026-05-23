"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, useReveal } from "./lib/motion";
import { useCtaHref } from "./lib/useCtaHref";

// Final CTA banner. The radial emerald gradients at the corners match
// Landing.html's `.cta-banner` — implemented as Tailwind gradient utilities
// so dark-mode overrides from globals.css pick up automatically.

export function Cta() {
  const reveal = useReveal();
  const t = useTranslations("landing.cta");
  const cta = useCtaHref();
  return (
    <motion.section
      {...reveal}
      data-testid="landing-cta"
      className="mx-auto my-16 w-full max-w-6xl px-6 sm:my-24 sm:px-10"
      variants={fadeUp}
    >
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card px-8 py-16 text-center shadow-[0_30px_80px_-40px_rgba(5,150,105,0.30)] sm:px-16 sm:py-24">
        {/* Multi-layer gradient mesh — three offset radials build atmospheric
            depth without animation. Top emerald glow + bottom warm tint +
            subtle center wash. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_0%,rgba(16,185,129,0.16),transparent_65%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_35%_at_15%_100%,rgba(5,150,105,0.10),transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_35%_at_85%_100%,rgba(20,184,166,0.08),transparent_60%)]"
        />
        {/* Hairline emerald accent at top edge */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-emerald-400/50 to-transparent"
        />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-[52px] sm:leading-[1.05]">
            {t("titlePrefix")}
            <br />
            <em className="font-serif italic text-foreground">
              {t("titleItalic")}
            </em>
          </h2>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("lede")}
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={cta.href}
              aria-disabled={cta.disabled}
              tabIndex={cta.disabled ? -1 : undefined}
              className={
                "inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background shadow-[0_8px_20px_-8px_rgba(15,23,42,0.4)] transition-all duration-200 hover:-translate-y-px hover:bg-foreground/90 hover:shadow-[0_12px_28px_-10px_rgba(15,23,42,0.5)] " +
                (cta.disabled ? "pointer-events-none opacity-70" : "")
              }
            >
              {t("primary")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="#how"
              className="inline-flex h-11 items-center rounded-full border border-border/70 bg-background/80 px-6 text-sm font-semibold text-foreground backdrop-blur-sm transition-colors hover:border-brand-emerald-300/60 hover:bg-muted"
            >
              {t("secondary")}
            </Link>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
