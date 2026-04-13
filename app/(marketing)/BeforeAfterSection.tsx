"use client";

import { Wand2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { renderBoldText } from "./renderBoldText";

const DURATION = 0.6;

export function BeforeAfterSection() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const base = { opacity: 0, y: noMotion ? 0 : 16 };
  const visible = {
    opacity: 1, y: 0,
    transition: { duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] as const },
  };

  return (
    <section aria-labelledby="before-after-heading" className="landing-section relative">
      <motion.div className="section-glow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.8 }} aria-hidden="true" />

      <motion.h2
        id="before-after-heading"
        className="text-center text-[1.75rem] font-bold leading-[1.1] tracking-[-0.01em] text-slate-900 sm:text-[2rem]"
        initial={base} whileInView={visible} viewport={{ once: true, amount: 0.15 }}
      >
        {t("beforeAfterTitle")}
      </motion.h2>

      <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-5 md:grid-cols-[1fr_auto_1fr]">
        {/* Before */}
        <motion.div
          className="landing-card border border-rose-100 bg-rose-50/50 p-7"
          initial={{ opacity: 0, x: noMotion ? 0 : -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-rose-400">
            {t("beforeLabel")}
          </span>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-slate-500 line-through decoration-rose-300/60">
            {t("beforeAfterBefore")}
          </p>
        </motion.div>

        {/* Wand — desktop */}
        <motion.div
          className="hidden items-center justify-center md:flex"
          initial={base} whileInView={visible}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ delay: noMotion ? 0 : 0.15, duration: noMotion ? 0 : DURATION }}
        >
          <motion.div
            whileInView={noMotion ? undefined : { rotate: [0, -8, 8, 0], scale: [1, 1.2, 1] }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <Wand2 className="h-7 w-7 text-emerald-500" aria-hidden="true" />
          </motion.div>
        </motion.div>

        {/* Wand — mobile */}
        <div className="flex items-center justify-center md:hidden">
          <Wand2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
        </div>

        {/* After */}
        <motion.div
          className="landing-card border border-emerald-100 bg-emerald-50/50 p-7"
          initial={{ opacity: 0, x: noMotion ? 0 : 24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ delay: noMotion ? 0 : 0.3, duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-emerald-500">
            {t("afterLabel")}
          </span>
          <p className="mt-4 text-[0.9375rem] font-medium leading-relaxed text-slate-900">
            {renderBoldText(t("beforeAfterAfter"))}
          </p>
        </motion.div>
      </div>

      <motion.p
        className="mt-10 text-center text-[1.0625rem] font-medium text-slate-500"
        initial={base} whileInView={visible}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ delay: noMotion ? 0 : 0.4, duration: noMotion ? 0 : DURATION }}
      >
        {t("beforeAfterTagline")}
      </motion.p>
    </section>
  );
}
