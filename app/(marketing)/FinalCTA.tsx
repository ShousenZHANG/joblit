"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { SmartCTA } from "./SmartCTA";
import { Shield, CreditCard, Github } from "lucide-react";

const DURATION = 0.65;

export function FinalCTA() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const base = { opacity: 0, y: noMotion ? 0 : 24 };
  const visible = {
    opacity: 1, y: 0,
    transition: { duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] as const },
  };

  return (
    <section aria-labelledby="final-cta-heading" className="relative py-20 sm:py-24">
      <motion.div
        className="brand-dark-section mx-auto max-w-4xl rounded-2xl px-6 py-14 text-center sm:rounded-3xl sm:px-12 sm:py-20"
        initial={{
          opacity: 0,
          filter: noMotion ? "blur(0px)" : "blur(6px)",
          scale: noMotion ? 1 : 0.97,
        }}
        whileInView={{
          opacity: 1, filter: "blur(0px)", scale: 1,
          transition: { duration: noMotion ? 0 : 0.7, ease: [0.25, 0.4, 0.25, 1] },
        }}
        viewport={{ once: true, amount: 0.15 }}
        style={{ boxShadow: "var(--shadow-deep)" }}
      >
        <h2
          id="final-cta-heading"
          className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-[2rem]"
        >
          {t("finalCtaTitle")}
        </h2>
        <p className="mt-4 text-base text-emerald-100/80 sm:text-lg">
          {t("finalCtaSubtitle")}
        </p>

        <SmartCTA
          label={t("finalCtaCta")}
          className="mt-8 min-h-[52px] bg-white px-8 text-base font-semibold text-emerald-900 shadow-[var(--shadow-elevated)] hover:bg-emerald-50 hover:shadow-[var(--shadow-deep)]"
        />

        {/* Trust badges */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-emerald-200/70">
          <span className="flex items-center gap-1.5">
            <Shield className="h-4 w-4" />
            Free forever
          </span>
          <span className="flex items-center gap-1.5">
            <CreditCard className="h-4 w-4" />
            No credit card
          </span>
          <span className="flex items-center gap-1.5">
            <Github className="h-4 w-4" />
            Open source
          </span>
        </div>
      </motion.div>
    </section>
  );
}
