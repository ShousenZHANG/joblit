"use client";

import { Sparkles, Shield, Languages, Layers, Cloud, FileType } from "lucide-react";
import { motion, useReducedMotion, useInView, useSpring, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRef, useState, useEffect, type ReactNode } from "react";

interface Feature {
  icon: ReactNode;
  titleKey: string;
  descKey: string;
}

const STAGGER = 0.1;
const DURATION = 0.6;

function NumberTicker({ target }: { target: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const springVal = useSpring(0, { duration: 1500, bounce: 0 });
  const display = useTransform(springVal, (v) => Math.floor(v));
  const [value, setValue] = useState(0);
  useEffect(() => { if (isInView) springVal.set(target); }, [isInView, springVal, target]);
  useEffect(() => { const unsub = display.on("change", (v) => setValue(v)); return unsub; }, [display]);
  return <span ref={ref}>{value}</span>;
}

function SkillPackDesc({ text }: { text: string }) {
  const numbers: Record<string, number> = { "35": 35, "29": 29, "18": 18 };
  const parts = text.split(/(\b(?:35|29|18)\b)/);
  return <>{parts.map((p, i) => numbers[p] ? <NumberTicker key={i} target={numbers[p]} /> : <span key={i}>{p}</span>)}</>;
}

export function FeaturesGrid() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const features: Feature[] = [
    { icon: <Sparkles className="h-5 w-5 text-emerald-600" />, titleKey: "featureSkillPackTitle", descKey: "featureSkillPackDesc" },
    { icon: <Shield className="h-5 w-5 text-emerald-600" />, titleKey: "featureAtsTitle", descKey: "featureAtsDesc" },
    { icon: <Languages className="h-5 w-5 text-emerald-600" />, titleKey: "featureBilingualTitle", descKey: "featureBilingualDesc" },
    { icon: <Layers className="h-5 w-5 text-emerald-600" />, titleKey: "featureBatchTitle", descKey: "featureBatchDesc" },
    { icon: <Cloud className="h-5 w-5 text-emerald-600" />, titleKey: "featureExternalAiTitle", descKey: "featureExternalAiDesc" },
    { icon: <FileType className="h-5 w-5 text-emerald-600" />, titleKey: "featureLatexTitle", descKey: "featureLatexDesc" },
  ];

  const base = { opacity: 0, y: noMotion ? 0 : 20 };
  const visible = {
    opacity: 1, y: 0,
    transition: { duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] as const },
  };

  return (
    <section aria-labelledby="features-heading" className="landing-section relative">
      <motion.div className="section-glow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.8 }} aria-hidden="true" />

      <motion.h2
        id="features-heading"
        className="text-center text-[1.75rem] font-bold leading-[1.1] tracking-[-0.01em] text-slate-900 sm:text-[2rem]"
        initial={base} whileInView={visible} viewport={{ once: true, margin: "-60px" }}
      >
        {t("featuresTitle")}
      </motion.h2>

      {/* Apple-style sparse grid: 2 hero + 4 standard */}
      <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-3 sm:mt-14 sm:grid-cols-2 sm:gap-4 lg:gap-5">
        {features.map((feature, i) => (
          <motion.div
            key={feature.titleKey}
            className={`landing-card p-6 lg:p-7 ${i < 2 ? "sm:col-span-1 lg:col-span-1" : ""}`}
            initial={base}
            whileInView={visible}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: noMotion ? 0 : STAGGER * i, duration: noMotion ? 0 : DURATION }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              {feature.icon}
            </div>
            <h3 className="mt-4 text-[1.0625rem] font-semibold leading-tight text-slate-900">
              {t(feature.titleKey)}
            </h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-slate-500">
              {feature.titleKey === "featureSkillPackTitle"
                ? <SkillPackDesc text={t(feature.descKey)} />
                : t(feature.descKey)}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
