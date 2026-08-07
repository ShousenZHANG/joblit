"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Magnetic } from "./lib/interactive";
import { revealUp, useReveal } from "./lib/motion";
import { useCtaHref } from "./lib/useCtaHref";

// The close — one line, not a movement. The previous full-screen gradient
// card restated the hero and read as filler; a page that has already made
// its argument should end with a quiet handshake: hairline rule, one
// sentence, one button.

export function Cta() {
  const reveal = useReveal();
  const t = useTranslations("landing.cta");
  const cta = useCtaHref();
  return (
    <motion.section
      {...reveal}
      data-testid="landing-cta"
      className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10 sm:py-20"
      variants={revealUp}
    >
      <div className="flex flex-col items-center justify-between gap-6 border-t border-border/60 pt-10 text-center sm:flex-row sm:text-left">
        <h2 className="text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t("titlePrefix")}{" "}
          <em className="font-serif italic">{t("titleItalic")}</em>
        </h2>
        <Magnetic strength={7}>
          <Link
            href={cta.href}
            prefetch={cta.prefetch}
            aria-disabled={cta.disabled}
            tabIndex={cta.disabled ? -1 : undefined}
            className={
              "group inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background shadow-[0_8px_20px_-8px_rgba(15,23,42,0.4)] transition-all duration-200 hover:-translate-y-px hover:bg-foreground/90 hover:shadow-[0_12px_28px_-10px_rgba(15,23,42,0.5)] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
              (cta.disabled ? "pointer-events-none opacity-70" : "")
            }
          >
            {cta.label}
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </Magnetic>
      </div>
    </motion.section>
  );
}
