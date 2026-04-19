"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, useReveal } from "./lib/motion";

// Final CTA banner. The radial emerald gradients at the corners match
// Landing.html's `.cta-banner` — implemented as Tailwind gradient utilities
// so dark-mode overrides from globals.css pick up automatically.

export function Cta() {
  const reveal = useReveal();
  const t = useTranslations("landing.cta");
  return (
    <motion.section
      {...reveal}
      data-testid="landing-cta"
      className="mx-auto my-16 w-full max-w-6xl px-6 sm:my-24 sm:px-10"
      variants={fadeUp}
    >
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-brand-emerald-50 via-background to-background px-8 py-16 text-center sm:px-16 sm:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_15%_10%,theme(colors.brand-emerald-100)/0.6,transparent_60%),radial-gradient(ellipse_60%_40%_at_85%_90%,theme(colors.brand-emerald-100)/0.5,transparent_60%)]"
        />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t("titlePrefix")}
            <br />
            <em className="font-serif italic text-brand-emerald-700">
              {t("titleItalic")}
            </em>
          </h2>
          <p className="mt-6 text-base text-muted-foreground sm:text-lg">
            {t("lede")}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background transition-transform hover:-translate-y-px hover:bg-foreground/90"
            >
              {t("primary")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="#how"
              className="inline-flex h-11 items-center rounded-full border border-border bg-background/70 px-6 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              {t("secondary")}
            </Link>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
