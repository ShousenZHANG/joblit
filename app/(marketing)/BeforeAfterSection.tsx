"use client";

import { Wand2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { renderBoldText } from "./renderBoldText";

const STAGGER = 0.14;
const DURATION = 0.65;

export function BeforeAfterSection() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const base = { opacity: 0, y: noMotion ? 0 : 14 };
  const visible = {
    opacity: 1, y: 0,
    transition: { duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] as const },
  };

  return (
    <section aria-labelledby="before-after-heading" className="relative py-20 sm:py-24">
      <motion.div className="section-glow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.8 }} aria-hidden="true" />

      <motion.h2
        id="before-after-heading"
        className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl lg:text-[2rem] lg:tracking-[-0.01em]"
        initial={base} whileInView={visible} viewport={{ once: true, amount: 0.15 }}
      >
        {t("beforeAfterTitle")}
      </motion.h2>

      <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-[1fr_auto_1fr]">
        {/* Before card */}
        <motion.div
          className="glass-card rounded-xl border-rose-200/60 bg-rose-50/40 p-7"
          initial={{ opacity: 0, x: noMotion ? 0 : -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-500">
            {t("beforeLabel")}
          </span>
          <motion.p
            className="mt-4 text-base leading-relaxed text-slate-600"
            whileInView={noMotion ? undefined : { textDecorationLine: "line-through" }}
            viewport={{ once: true }}
            transition={{ delay: 0.5, duration: 0.8 }}
            style={{ textDecorationColor: "rgb(253, 164, 175)" }}
          >
            {t("beforeAfterBefore")}
          </motion.p>
        </motion.div>

        {/* Wand icon */}
        <motion.div
          className="hidden items-center justify-center md:flex"
          initial={base} whileInView={visible}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ delay: noMotion ? 0 : STAGGER, duration: noMotion ? 0 : DURATION }}
        >
          <motion.div
            whileInView={noMotion ? undefined : { rotate: [0, -10, 10, 0], scale: [1, 1.3, 1] }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <Wand2 className="h-7 w-7 text-emerald-500" aria-hidden="true" />
          </motion.div>
        </motion.div>

        {/* Mobile wand */}
        <div className="flex items-center justify-center md:hidden">
          <Wand2 className="h-5 w-5 text-emerald-500" aria-hidden="true" />
        </div>

        {/* After card */}
        <motion.div
          className="glass-card rounded-xl border-emerald-200/60 bg-emerald-50/40 p-7"
          initial={{ opacity: 0, x: noMotion ? 0 : 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ delay: noMotion ? 0 : STAGGER * 2, duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
            {t("afterLabel")}
          </span>
          <p className="mt-4 text-base font-medium leading-relaxed text-slate-900">
            {renderBoldText(t("beforeAfterAfter"))}
          </p>
        </motion.div>
      </div>

      <motion.p
        className="mt-10 text-center text-base font-medium text-slate-600 sm:text-lg"
        initial={base} whileInView={visible}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ delay: noMotion ? 0 : STAGGER * 3, duration: noMotion ? 0 : DURATION }}
      >
        {t("beforeAfterTagline")}
      </motion.p>
    </section>
  );
}
