"use client";

import { Sparkles, Shield, Languages, Layers, Cloud, FileType } from "lucide-react";
import { motion, useReducedMotion, useInView, useSpring, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRef, useState, useEffect, type ReactNode } from "react";

interface Feature {
  icon: ReactNode;
  titleKey: string;
  descKey: string;
  accent: string;
}

const STAGGER = 0.08;
const DURATION = 0.55;

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
  const ANIMATED_NUMBERS: Record<string, number> = { "35": 35, "29": 29, "18": 18 };
  const pattern = new RegExp(`(\\b(?:${Object.keys(ANIMATED_NUMBERS).join("|")})\\b)`);
  const parts = text.split(pattern);
  return <>{parts.map((p, i) => ANIMATED_NUMBERS[p] ? <NumberTicker key={i} target={ANIMATED_NUMBERS[p]} /> : <span key={i}>{p}</span>)}</>;
}

export function FeaturesGrid() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const features: Feature[] = [
    { icon: <Sparkles className="h-5 w-5 text-emerald-600" />, titleKey: "featureSkillPackTitle", descKey: "featureSkillPackDesc", accent: "border-l-emerald-500" },
    { icon: <Shield className="h-5 w-5 text-teal-600" />, titleKey: "featureAtsTitle", descKey: "featureAtsDesc", accent: "border-l-teal-500" },
    { icon: <Languages className="h-5 w-5 text-amber-600" />, titleKey: "featureBilingualTitle", descKey: "featureBilingualDesc", accent: "border-l-amber-500" },
    { icon: <Layers className="h-5 w-5 text-emerald-600" />, titleKey: "featureBatchTitle", descKey: "featureBatchDesc", accent: "border-l-emerald-500" },
    { icon: <Cloud className="h-5 w-5 text-teal-600" />, titleKey: "featureExternalAiTitle", descKey: "featureExternalAiDesc", accent: "border-l-teal-500" },
    { icon: <FileType className="h-5 w-5 text-amber-600" />, titleKey: "featureLatexTitle", descKey: "featureLatexDesc", accent: "border-l-amber-500" },
  ];

  return (
    <section aria-labelledby="features-heading" className="landing-section relative">
      <motion.div className="section-glow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.8 }} aria-hidden="true" />

      <motion.h2
        id="features-heading"
        className="text-center text-[1.75rem] font-bold leading-[1.1] tracking-[-0.01em] text-slate-900 sm:text-[2rem]"
        initial={{ opacity: 0, y: noMotion ? 0 : 20 }}
        whileInView={{ opacity: 1, y: 0, transition: { duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] } }}
        viewport={{ once: true, amount: 0.3 }}
      >
        {t("featuresTitle")}
      </motion.h2>

      <div className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4">
        {features.map((feature, i) => (
          <motion.div
            key={feature.titleKey}
            className={`landing-card flex items-start gap-4 border-l-[3px] p-4 text-left sm:p-5 ${feature.accent}`}
            initial={{ opacity: 0, y: noMotion ? 0 : 28, x: noMotion ? 0 : (i % 2 === 0 ? -12 : 12) }}
            whileInView={{
              opacity: 1, y: 0, x: 0,
              transition: { delay: noMotion ? 0 : STAGGER * i, duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] },
            }}
            viewport={{ once: true, amount: 0.15 }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
              {feature.icon}
            </div>
            <div>
              <h3 className="text-[0.9375rem] font-semibold leading-snug text-slate-900 sm:text-base">
                {t(feature.titleKey)}
              </h3>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-slate-500 sm:text-sm">
                {feature.titleKey === "featureSkillPackTitle"
                  ? <SkillPackDesc text={t(feature.descKey)} />
                  : t(feature.descKey)}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
