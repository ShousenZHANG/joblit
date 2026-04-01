"use client";

import {
  Sparkles,
  Shield,
  Languages,
  Layers,
  Cloud,
  FileType,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

interface Feature {
  icon: ReactNode;
  titleKey: string;
  descKey: string;
}

const stagger = 0.08;
const duration = 0.4;

export function FeaturesGrid() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const features: Feature[] = [
    {
      icon: <Sparkles className="h-5 w-5 text-emerald-600" />,
      titleKey: "featureSkillPackTitle",
      descKey: "featureSkillPackDesc",
    },
    {
      icon: <Shield className="h-5 w-5 text-emerald-600" />,
      titleKey: "featureAtsTitle",
      descKey: "featureAtsDesc",
    },
    {
      icon: <Languages className="h-5 w-5 text-emerald-600" />,
      titleKey: "featureBilingualTitle",
      descKey: "featureBilingualDesc",
    },
    {
      icon: <Layers className="h-5 w-5 text-emerald-600" />,
      titleKey: "featureBatchTitle",
      descKey: "featureBatchDesc",
    },
    {
      icon: <Cloud className="h-5 w-5 text-emerald-600" />,
      titleKey: "featureExternalAiTitle",
      descKey: "featureExternalAiDesc",
    },
    {
      icon: <FileType className="h-5 w-5 text-emerald-600" />,
      titleKey: "featureLatexTitle",
      descKey: "featureLatexDesc",
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
    <section aria-labelledby="features-heading" className="py-16 sm:py-20">
      <motion.h2
        id="features-heading"
        className="text-center text-2xl font-bold text-slate-900 sm:text-3xl"
        initial={base}
        whileInView={visible}
        viewport={{ once: true }}
      >
        {t("featuresTitle")}
      </motion.h2>

      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => (
          <motion.div
            key={feature.titleKey}
            className="rounded-xl border border-slate-200 bg-white/80 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            initial={base}
            whileInView={visible}
            viewport={{ once: true }}
            transition={{
              delay: noMotion ? 0 : stagger * i,
              duration: noMotion ? 0 : duration,
            }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
              {feature.icon}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">
              {t(feature.titleKey)}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {t(feature.descKey)}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
