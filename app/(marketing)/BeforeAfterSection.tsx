"use client";

import { Wand2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { renderBoldText } from "./renderBoldText";

const stagger = 0.1;
const duration = 0.4;

export function BeforeAfterSection() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const base = {
    opacity: 0,
    y: noMotion ? 0 : 14,
  };
  const visible = {
    opacity: 1,
    y: 0,
    transition: {
      duration: noMotion ? 0 : duration,
      ease: [0.25, 0.4, 0.25, 1] as const,
    },
  };

  return (
    <section
      aria-labelledby="before-after-heading"
      className="py-16 sm:py-20"
    >
      <motion.h2
        id="before-after-heading"
        className="text-center text-2xl font-bold text-slate-900 sm:text-3xl"
        initial={base}
        whileInView={visible}
        viewport={{ once: true }}
      >
        {t("beforeAfterTitle")}
      </motion.h2>

      <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-[1fr_auto_1fr]">
        {/* Before card */}
        <motion.div
          className="rounded-xl border border-rose-200 bg-rose-50/30 p-6"
          initial={base}
          whileInView={visible}
          viewport={{ once: true }}
          transition={{
            delay: noMotion ? 0 : 0,
            duration: noMotion ? 0 : duration,
          }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-500">
            {t("beforeLabel")}
          </span>
          <p className="mt-3 text-sm text-slate-600 line-through decoration-rose-300">
            {t("beforeAfterBefore")}
          </p>
        </motion.div>

        {/* Wand icon between cards */}
        <motion.div
          className="hidden items-center justify-center md:flex"
          initial={base}
          whileInView={visible}
          viewport={{ once: true }}
          transition={{
            delay: noMotion ? 0 : stagger,
            duration: noMotion ? 0 : duration,
          }}
        >
          <Wand2 className="h-6 w-6 text-emerald-500" />
        </motion.div>

        {/* Mobile wand icon */}
        <div className="flex items-center justify-center md:hidden">
          <Wand2 className="h-5 w-5 text-emerald-500" />
        </div>

        {/* After card */}
        <motion.div
          className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-6"
          initial={base}
          whileInView={visible}
          viewport={{ once: true }}
          transition={{
            delay: noMotion ? 0 : stagger * 2,
            duration: noMotion ? 0 : duration,
          }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
            {t("afterLabel")}
          </span>
          <p className="mt-3 text-sm font-medium text-slate-900">
            {renderBoldText(t("beforeAfterAfter"))}
          </p>
        </motion.div>
      </div>

      <motion.p
        className="mt-8 text-center text-sm font-medium text-slate-600"
        initial={base}
        whileInView={visible}
        viewport={{ once: true }}
        transition={{
          delay: noMotion ? 0 : stagger * 3,
          duration: noMotion ? 0 : duration,
        }}
      >
        {t("beforeAfterTagline")}
      </motion.p>
    </section>
  );
}
