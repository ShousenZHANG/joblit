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
    <header className="grid w-full max-w-5xl gap-10 text-center lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:text-left">
      <div className="flex flex-col items-center lg:items-start">
        <motion.div
          initial={base}
          animate={visible}
          transition={{ delay: noMotion ? 0 : 0 }}
        >
          <Badge className="edu-pill">
            <span
              className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            {badgeLabel}
          </Badge>
        </motion.div>
        <motion.h1
          className="edu-title mt-6 text-4xl leading-tight text-slate-900 md:text-6xl"
          initial={base}
          animate={visible}
          transition={{ delay: noMotion ? 0 : stagger * 1 }}
        >
          {heroTitle}
        </motion.h1>
        <motion.p
          className="mt-5 max-w-xl text-base text-slate-600 md:text-lg"
          initial={base}
          animate={visible}
          transition={{ delay: noMotion ? 0 : stagger * 2 }}
        >
          {heroSubtitle}
        </motion.p>
        <motion.div
          className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start"
          initial={base}
          animate={visible}
          transition={{ delay: noMotion ? 0 : stagger * 3 }}
        >
          <Button asChild size="lg" className="edu-cta edu-cta--press">
            <Link href="/login">
              {ctaLabel} <ArrowRight className="h-4 w-4" />
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
