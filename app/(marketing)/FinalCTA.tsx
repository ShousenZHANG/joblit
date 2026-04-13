"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { SmartCTA } from "./SmartCTA";
import { Shield, CreditCard, Github } from "lucide-react";

const DURATION = 0.6;

export function FinalCTA() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  return (
    <section aria-labelledby="final-cta-heading" className="landing-section relative">
      <motion.div
        className="brand-dark-section mx-auto max-w-5xl rounded-xl px-5 py-12 text-center sm:rounded-2xl sm:px-8 sm:py-16 lg:rounded-3xl lg:px-14 lg:py-24"
        initial={{
          opacity: 0,
          scale: noMotion ? 1 : 0.98,
        }}
        whileInView={{
          opacity: 1, scale: 1,
          transition: { duration: noMotion ? 0 : 0.7, ease: [0.25, 0.4, 0.25, 1] },
        }}
        viewport={{ once: true, amount: 0.15 }}
        style={{ boxShadow: "var(--shadow-deep)" }}
      >
        <h2
          id="final-cta-heading"
          className="text-[1.75rem] font-bold leading-[1.1] tracking-[-0.01em] text-white sm:text-[2.25rem]"
        >
          {t("finalCtaTitle")}
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-[1.0625rem] leading-relaxed text-emerald-100/70">
          {t("finalCtaSubtitle")}
        </p>

        <SmartCTA
          label={t("finalCtaCta")}
          className="mt-10 min-h-[52px] rounded-xl bg-white px-9 text-[1.0625rem] font-semibold text-emerald-900 shadow-[var(--shadow-elevated)] transition-all hover:bg-emerald-50 hover:shadow-[var(--shadow-deep)]"
        />

        {/* Trust badges */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-emerald-200/60 sm:mt-10 sm:gap-x-8 sm:gap-y-3 sm:text-[0.8125rem]">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Free forever
          </span>
          <span className="flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" />
            No credit card
          </span>
          <span className="flex items-center gap-1.5">
            <Github className="h-3.5 w-3.5" />
            Open source
          </span>
        </div>
      </motion.div>
    </section>
  );
}
