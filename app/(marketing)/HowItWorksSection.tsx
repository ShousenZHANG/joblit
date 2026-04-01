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

const stagger = 0.12;
const duration = 0.4;

export function HowItWorksSection() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const steps: Step[] = [
    {
      number: 1,
      icon: <Search className="mx-auto mt-3 h-6 w-6 text-emerald-600" />,
      titleKey: "howItWorksStep1Title",
      descKey: "howItWorksStep1Desc",
    },
    {
      number: 2,
      icon: <Wand2 className="mx-auto mt-3 h-6 w-6 text-emerald-600" />,
      titleKey: "howItWorksStep2Title",
      descKey: "howItWorksStep2Desc",
    },
    {
      number: 3,
      icon: <FileText className="mx-auto mt-3 h-6 w-6 text-emerald-600" />,
      titleKey: "howItWorksStep3Title",
      descKey: "howItWorksStep3Desc",
    },
  ];

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
    <section aria-labelledby="how-it-works-heading" className="py-16 sm:py-20">
      <motion.h2
        id="how-it-works-heading"
        className="text-center text-2xl font-bold text-slate-900 sm:text-3xl"
        initial={base}
        whileInView={visible}
        viewport={{ once: true }}
      >
        {t("howItWorksTitle")}
      </motion.h2>

      <div className="mt-12 flex items-start justify-center gap-0">
        {steps.map((step, i) => (
          <div key={step.number} className="flex items-start">
            <motion.div
              className="flex w-full max-w-xs flex-col items-center text-center"
              initial={base}
              whileInView={visible}
              viewport={{ once: true }}
              transition={{
                delay: noMotion ? 0 : stagger * i,
                duration: noMotion ? 0 : duration,
              }}
            >
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">
                {step.number}
              </div>
              {step.icon}
              <h3 className="mt-3 text-center text-sm font-semibold text-slate-900">
                {t(step.titleKey)}
              </h3>
              <p className="mx-auto mt-1 max-w-xs text-center text-sm text-slate-600">
                {t(step.descKey)}
              </p>
            </motion.div>
            {i < steps.length - 1 && (
              <div className="mt-5 hidden h-px flex-1 self-center border-t border-dashed border-slate-300 md:block" style={{ minWidth: "2rem" }} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
