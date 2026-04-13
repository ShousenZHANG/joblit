"use client";

import { useRef, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { TailoringDemoCard } from "./TailoringDemoCard";
import { SmartCTA } from "./SmartCTA";

const WORD_DELAY = 0.04;

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

  const fade = (delay: number) => ({
    initial: { opacity: 0, y: noMotion ? 0 : 16 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: noMotion ? 0 : 0.5, delay: noMotion ? 0 : delay, ease: [0.25, 0.4, 0.25, 1] as const },
    },
  });

  const words = heroTitle.split(" ");

  return (
    <header
      ref={headerRef}
      onMouseMove={handleMouseMove}
      className="group relative grid w-full max-w-6xl gap-12 overflow-hidden text-center sm:gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-20 lg:text-left"
    >
      {/* Spotlight */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100"
        style={{ background: "radial-gradient(600px circle at var(--spotlight-x) var(--spotlight-y), rgba(16,185,129,0.05), transparent 80%)" }}
        aria-hidden="true"
      />

      <div className="relative z-[1] flex flex-col items-center lg:items-start">
        {/* Badge */}
        <motion.div {...fade(0)}>
          <Badge className="edu-pill-pro text-sm">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
            {badgeLabel}
          </Badge>
        </motion.div>

        {/* Title — Apple-style tight, word-by-word reveal */}
        <h1 className="mt-8 text-[2rem] font-bold leading-[1.08] tracking-[-0.02em] text-slate-900 sm:text-[2.5rem] md:text-[2.75rem] lg:text-[3.5rem]">
          {words.map((word, i) => {
            const isGradient = word === "AI-tailored";
            return (
              <motion.span
                key={i}
                className={`inline-block ${isGradient ? "bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent" : ""}`}
                initial={{ opacity: 0, y: noMotion ? 0 : 10 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { duration: noMotion ? 0 : 0.4, delay: noMotion ? 0 : 0.15 + i * WORD_DELAY, ease: [0.25, 0.4, 0.25, 1] },
                }}
              >
                {word}&nbsp;
              </motion.span>
            );
          })}
        </h1>

        {/* Subtitle — Apple-style lighter weight, generous size */}
        <motion.p
          className="mt-5 max-w-lg text-[1.125rem] leading-[1.5] text-slate-500 sm:mt-6 sm:text-[1.25rem] lg:text-[1.375rem]"
          {...fade(0.45)}
        >
          {heroSubtitle}
        </motion.p>

        {/* CTA */}
        <motion.div
          className="mt-8 flex flex-wrap justify-center gap-3 sm:mt-10 lg:justify-start"
          {...fade(0.55)}
        >
          <SmartCTA
            label={ctaLabel}
            className="edu-cta-shimmer min-h-[52px] min-w-[44px] rounded-xl px-8 text-[1.0625rem] shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-elevated)]"
          />
        </motion.div>
      </div>

      {/* Demo card */}
      <motion.div
        className="relative z-[1] flex w-full items-center justify-center lg:justify-end"
        {...fade(0.35)}
      >
        <TailoringDemoCard />
      </motion.div>
    </header>
  );
}
