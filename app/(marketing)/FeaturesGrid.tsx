"use client";

import {
  Sparkles, Shield, Languages, Layers, Cloud, FileType,
} from "lucide-react";
import { motion, useReducedMotion, useInView, useSpring, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";

interface Feature {
  icon: ReactNode;
  titleKey: string;
  descKey: string;
  iconBg: string;
}

const STAGGER = 0.1;
const DURATION = 0.65;

function NumberTicker({ target }: { target: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const springVal = useSpring(0, { duration: 1500, bounce: 0 });
  const display = useTransform(springVal, (v) => Math.floor(v));
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (isInView) springVal.set(target);
  }, [isInView, springVal, target]);

  useEffect(() => {
    const unsub = display.on("change", (v) => setValue(v));
    return unsub;
  }, [display]);

  return <span ref={ref}>{value}</span>;
}

export function FeaturesGrid() {
  const t = useTranslations("marketing");
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;

  const features: Feature[] = [
    { icon: <Sparkles className="h-5 w-5 text-emerald-600" />, titleKey: "featureSkillPackTitle", descKey: "featureSkillPackDesc", iconBg: "bg-emerald-50" },
    { icon: <Shield className="h-5 w-5 text-teal-600" />, titleKey: "featureAtsTitle", descKey: "featureAtsDesc", iconBg: "bg-teal-50" },
    { icon: <Languages className="h-5 w-5 text-amber-600" />, titleKey: "featureBilingualTitle", descKey: "featureBilingualDesc", iconBg: "bg-amber-50" },
    { icon: <Layers className="h-5 w-5 text-emerald-600" />, titleKey: "featureBatchTitle", descKey: "featureBatchDesc", iconBg: "bg-emerald-50" },
    { icon: <Cloud className="h-5 w-5 text-teal-600" />, titleKey: "featureExternalAiTitle", descKey: "featureExternalAiDesc", iconBg: "bg-teal-50" },
    { icon: <FileType className="h-5 w-5 text-amber-600" />, titleKey: "featureLatexTitle", descKey: "featureLatexDesc", iconBg: "bg-amber-50" },
  ];

  const base = { opacity: 0, y: noMotion ? 0 : 24, scale: noMotion ? 1 : 0.97 };
  const visible = {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: noMotion ? 0 : DURATION, ease: [0.25, 0.4, 0.25, 1] as const },
  };

  return (
    <section aria-labelledby="features-heading" className="relative py-20 sm:py-24">
      <motion.div className="section-glow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.8 }} aria-hidden="true" />

      <motion.h2
        id="features-heading"
        className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl lg:text-[2rem] lg:tracking-[-0.01em]"
        initial={base} whileInView={visible} viewport={{ once: true, margin: "-50px" }}
      >
        {t("featuresTitle")}
      </motion.h2>

      {/* Bento grid: first 2 span full width, remaining 4 in 2x2 */}
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature, i) => {
          const isHero = i < 2;
          return (
            <TiltCard key={feature.titleKey} noMotion={noMotion}>
              <motion.div
                className={`glass-card h-full rounded-xl p-5 ${isHero ? "lg:col-span-2" : ""}`}
                initial={base}
                whileInView={visible}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: noMotion ? 0 : STAGGER * i, duration: noMotion ? 0 : DURATION }}
                style={isHero ? { gridColumn: "span 2" } : undefined}
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${feature.iconBg}`}>
                  {feature.icon}
                </div>
                <h3 className="mt-3 text-base font-semibold text-slate-900">
                  {t(feature.titleKey)}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 sm:text-base">
                  {feature.titleKey === "featureSkillPackTitle"
                    ? <SkillPackDesc text={t(feature.descKey)} />
                    : t(feature.descKey)}
                </p>
              </motion.div>
            </TiltCard>
          );
        })}
      </div>
    </section>
  );
}

function SkillPackDesc({ text }: { text: string }) {
  const numbers: Record<string, number> = { "35": 35, "29": 29, "18": 18 };
  const parts = text.split(/(\b(?:35|29|18)\b)/);
  return (
    <>
      {parts.map((part, i) =>
        numbers[part] ? <NumberTicker key={i} target={numbers[part]} /> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

function TiltCard({ children, noMotion }: { children: ReactNode; noMotion: boolean }) {
  const [rotate, setRotate] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (noMotion) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (rect.width / 2);
      const dy = (e.clientY - cy) / (rect.height / 2);
      setRotate({ x: -dy * 2, y: dx * 2 });
    },
    [noMotion],
  );

  const handleMouseLeave = useCallback(() => setRotate({ x: 0, y: 0 }), []);

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transformStyle: "preserve-3d",
        transform: `perspective(800px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
        transition: "transform 0.15s ease-out",
      }}
    >
      {children}
    </div>
  );
}
