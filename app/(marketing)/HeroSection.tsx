"use client";

import { useRef, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { TailoringDemoCard } from "./TailoringDemoCard";
import { SmartCTA } from "./SmartCTA";

const WORD_DELAY = 0.05;
const DURATION = 0.4;

export interface HeroSectionProps {
  heroTitle: string;
  heroSubtitle: string;
  ctaLabel: string;
  badgeLabel: string;
}

export function HeroSection({
  heroTitle,
  heroSubtitle,
  ctaLabel,
  badgeLabel,
}: HeroSectionProps) {
  const reduceMotion = useReducedMotion();
  const noMotion = reduceMotion === true;
  const headerRef = useRef<HTMLElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const el = headerRef.current;
      if (!el || noMotion) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--spotlight-x", `${e.clientX - rect.left}px`);
      el.style.setProperty("--spotlight-y", `${e.clientY - rect.top}px`);
    },
    [noMotion],
  );

  const base = { opacity: 0, y: noMotion ? 0 : 18 };
  const visible = (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: noMotion ? 0 : DURATION,
      delay: noMotion ? 0 : delay,
      ease: [0.25, 0.4, 0.25, 1] as const,
    },
  });

  // Split title into words for staggered reveal
  const words = heroTitle.split(" ");

  return (
    <header
      ref={headerRef}
      onMouseMove={handleMouseMove}
      className="group relative grid w-full max-w-6xl gap-10 overflow-hidden text-center sm:gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:text-left"
    >
      {/* Spotlight cursor overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(600px circle at var(--spotlight-x) var(--spotlight-y), rgba(16,185,129,0.06), transparent 80%)",
        }}
        aria-hidden="true"
      />

      <div className="relative z-[1] flex flex-col items-center lg:items-start">
        {/* Badge */}
        <motion.div initial={base} animate={visible(0)}>
          <Badge className="edu-pill-pro text-sm">
            <span
              className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            {badgeLabel}
          </Badge>
        </motion.div>

        {/* Title — word-by-word staggered fade-in */}
        <h1 className="mt-7 text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-4xl md:text-[2.75rem] lg:text-[3.25rem] lg:leading-[1.08] lg:tracking-[-0.02em]">
          {words.map((word, i) => {
            const isGradient = word === "AI-tailored";
            return (
              <motion.span
                key={i}
                className={`inline-block ${isGradient ? "bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent" : ""}`}
                initial={{ opacity: 0, y: noMotion ? 0 : 12, filter: noMotion ? "blur(0px)" : "blur(4px)" }}
                animate={{
                  opacity: 1,
                  y: 0,
                  filter: "blur(0px)",
                  transition: {
                    duration: noMotion ? 0 : 0.35,
                    delay: noMotion ? 0 : 0.2 + i * WORD_DELAY,
                    ease: [0.25, 0.4, 0.25, 1],
                  },
                }}
              >
                {word}&nbsp;
              </motion.span>
            );
          })}
        </h1>

        {/* Subtitle */}
        <motion.p
          className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 sm:mt-6 sm:text-xl sm:leading-8"
          initial={base}
          animate={visible(0.5)}
        >
          {heroSubtitle}
        </motion.p>

        {/* CTA */}
        <motion.div
          className="mt-7 flex flex-wrap justify-center gap-3 sm:mt-9 lg:justify-start"
          initial={base}
          animate={visible(0.6)}
        >
          <SmartCTA
            label={ctaLabel}
            className="edu-cta-shimmer min-h-[52px] min-w-[44px] px-7 text-base shadow-[var(--shadow-standard)] hover:shadow-[var(--shadow-elevated)]"
          />
        </motion.div>
      </div>

      {/* Demo card */}
      <motion.div
        className="relative z-[1] flex w-full items-center justify-center lg:justify-end"
        initial={base}
        animate={visible(0.4)}
      >
        <TailoringDemoCard />
      </motion.div>
    </header>
  );
}
