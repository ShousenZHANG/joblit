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

const STAGGER = 0.18;
const DURATION = 0.65;

function AnimatedBeam() {
  return (
    <div className="mt-6 hidden flex-1 self-center md:block" style={{ minWidth: "2rem" }}>
      <svg width="100%" height="6" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
        <motion.line
          x1="0" y1="3" x2="100" y2="3"
          stroke="url(#beam-grad)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="100"
          strokeDashoffset={100}
          whileInView={{ strokeDashoffset: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        />
        <defs>
          <linearGradient id="beam-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgb(52, 211, 153)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="rgb(20, 184, 166)" stopOpacity="0.4" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export function HowItWorksSection() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const steps: Step[] = [
    { number: 1, icon: <Search className="h-6 w-6 text-emerald-600" aria-hidden="true" />, titleKey: "howItWorksStep1Title", descKey: "howItWorksStep1Desc" },
    { number: 2, icon: <Wand2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />, titleKey: "howItWorksStep2Title", descKey: "howItWorksStep2Desc" },
    { number: 3, icon: <FileText className="h-6 w-6 text-emerald-600" aria-hidden="true" />, titleKey: "howItWorksStep3Title", descKey: "howItWorksStep3Desc" },
  ];

  const base = { opacity: 0, y: noMotion ? 0 : 30 };
  const visible = {
    opacity: 1, y: 0,
    transition: { duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] as const },
  };

  return (
    <section aria-labelledby="how-it-works-heading" className="relative py-20 sm:py-24">
      <motion.div className="section-glow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.8 }} aria-hidden="true" />

      <motion.h2
        id="how-it-works-heading"
        className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl lg:text-[2rem] lg:tracking-[-0.01em]"
        initial={base} whileInView={visible} viewport={{ once: true, margin: "-50px" }}
      >
        {t("howItWorksTitle")}
      </motion.h2>

      <div className="mt-14 flex items-start justify-center gap-0">
        {steps.map((step, i) => (
          <div key={step.number} className="flex items-start">
            <motion.div
              className="group glass-card flex w-full max-w-xs flex-col items-center rounded-xl p-6 text-center"
              initial={base} whileInView={visible}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ delay: noMotion ? 0 : STAGGER * i, duration: noMotion ? 0 : DURATION }}
            >
              {/* Gradient number badge */}
              <motion.div
                className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-400 text-sm font-bold text-white shadow-[var(--shadow-standard)]"
                whileInView={noMotion ? undefined : { scale: [1, 1.12, 1] }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ delay: noMotion ? 0 : STAGGER * i + 0.3, duration: 0.4 }}
              >
                <span aria-hidden="true">{step.number}</span>
                <span className="sr-only">Step {step.number}</span>
              </motion.div>

              <div className="mx-auto mt-4 transition-transform duration-300 group-hover:scale-110">
                {step.icon}
              </div>

              <h3 className="mt-3 text-center text-base font-semibold text-slate-900">
                {t(step.titleKey)}
              </h3>
              <p className="mx-auto mt-1.5 max-w-xs text-center text-sm text-slate-600 sm:text-base">
                {t(step.descKey)}
              </p>
            </motion.div>
            {i < steps.length - 1 && <AnimatedBeam />}
          </div>
        ))}
      </div>
    </section>
  );
}
