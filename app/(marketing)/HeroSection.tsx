"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DemoCard } from "./DemoCard";

const stagger = 0.08;
const duration = 0.4;

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
    <header className="grid w-full max-w-6xl gap-8 text-center sm:gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12 lg:text-left">
      <div className="flex flex-col items-center lg:items-start">
        <motion.div
          initial={base}
          animate={visible}
          transition={{ delay: noMotion ? 0 : 0 }}
        >
          <Badge className="edu-pill-pro">
            <span
              className="mr-2 inline-block h-2 w-2 rounded-full bg-[#0a66c2]"
              aria-hidden="true"
            />
            {badgeLabel}
          </Badge>
        </motion.div>
        <motion.h1
          className="edu-title mt-6 text-3xl leading-tight tracking-tight text-slate-900 sm:text-4xl md:text-5xl lg:text-6xl lg:leading-[1.1]"
          initial={base}
          animate={visible}
          transition={{ delay: noMotion ? 0 : stagger * 1 }}
        >
          {heroTitle}
        </motion.h1>
        <motion.p
          className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:mt-5 sm:text-lg sm:leading-7"
          initial={base}
          animate={visible}
          transition={{ delay: noMotion ? 0 : stagger * 2 }}
        >
          {heroSubtitle}
        </motion.p>
        <motion.div
          className="mt-6 flex flex-wrap justify-center gap-3 sm:mt-8 lg:justify-start"
          initial={base}
          animate={visible}
          transition={{ delay: noMotion ? 0 : stagger * 3 }}
        >
          <Button
            asChild
            size="lg"
            className="edu-cta-pro min-h-[48px] min-w-[44px] px-6"
          >
            <Link href="/login">
              {ctaLabel} <ArrowRight className="h-4 w-4 shrink-0" />
            </Link>
          </Button>
        </motion.div>
      </div>

      <motion.div
        className="flex w-full items-center justify-center lg:justify-end"
        initial={base}
        animate={visible}
        transition={{ delay: noMotion ? 0 : stagger * 4 }}
      >
        <DemoCard />
      </motion.div>
    </header>
  );
}
