"use client";

import { Search, Wand2, FileText } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

interface Step {
  number: number;
  icon: ReactNode;
  titleKey: string;
  descKey: string;
}

const STAGGER = 0.2;
const DURATION = 0.6;

export function HowItWorksSection() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const steps: Step[] = [
    { number: 1, icon: <Search className="h-6 w-6 text-emerald-600" aria-hidden="true" />, titleKey: "howItWorksStep1Title", descKey: "howItWorksStep1Desc" },
    { number: 2, icon: <Wand2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />, titleKey: "howItWorksStep2Title", descKey: "howItWorksStep2Desc" },
    { number: 3, icon: <FileText className="h-6 w-6 text-emerald-600" aria-hidden="true" />, titleKey: "howItWorksStep3Title", descKey: "howItWorksStep3Desc" },
  ];

  const base = { opacity: 0, y: noMotion ? 0 : 24 };
  const visible = {
    opacity: 1, y: 0,
    transition: { duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] as const },
  };

  return (
    <section aria-labelledby="how-it-works-heading" className="landing-section relative">
      <motion.div className="section-glow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.8 }} aria-hidden="true" />

      <motion.h2
        id="how-it-works-heading"
        className="text-center text-[1.75rem] font-bold leading-[1.1] tracking-[-0.01em] text-slate-900 sm:text-[2rem]"
        initial={base} whileInView={visible} viewport={{ once: true, margin: "-60px" }}
      >
        {t("howItWorksTitle")}
      </motion.h2>

      {/* Desktop: horizontal row */}
      <div className="mx-auto mt-16 hidden max-w-4xl md:grid md:grid-cols-3 md:gap-6">
        {steps.map((step, i) => (
          <motion.div
            key={step.number}
            className="landing-card flex flex-col items-center p-8 text-center"
            initial={base} whileInView={visible}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ delay: noMotion ? 0 : STAGGER * i, duration: noMotion ? 0 : DURATION }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-400 text-sm font-bold text-white">
              {step.number}
            </div>
            <div className="mt-5">{step.icon}</div>
            <h3 className="mt-4 text-[1.0625rem] font-semibold leading-tight text-slate-900">{t(step.titleKey)}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-slate-500">{t(step.descKey)}</p>
          </motion.div>
        ))}
      </div>

      {/* Mobile: vertical stack with connector line */}
      <div className="mx-auto mt-12 flex max-w-sm flex-col gap-4 md:hidden">
        {steps.map((step, i) => (
          <motion.div
            key={step.number}
            className="landing-card relative flex items-start gap-4 p-5"
            initial={base} whileInView={visible}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ delay: noMotion ? 0 : STAGGER * i, duration: noMotion ? 0 : DURATION }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-400 text-xs font-bold text-white">
              {step.number}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{t(step.titleKey)}</h3>
              <p className="mt-1 text-sm text-slate-500">{t(step.descKey)}</p>
            </div>
            {i < steps.length - 1 && (
              <div className="absolute bottom-0 left-[1.19rem] h-4 w-px translate-y-full bg-emerald-200" aria-hidden="true" />
            )}
          </motion.div>
        ))}
      </div>
    </section>
  );
}
