"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

const duration = 0.4;

export function FinalCTA() {
  const t = useTranslations("marketing");
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
    <section aria-labelledby="final-cta-heading" className="py-16 sm:py-20">
      <motion.div
        className="flex flex-col items-center text-center"
        initial={base}
        whileInView={visible}
        viewport={{ once: true }}
      >
        <h2
          id="final-cta-heading"
          className="text-2xl font-bold text-slate-900 sm:text-3xl"
        >
          {t("finalCtaTitle")}
        </h2>
        <p className="mt-3 text-sm text-slate-600">{t("finalCtaSubtitle")}</p>
        <Button
          asChild
          size="lg"
          className="edu-cta-pro mt-6 min-h-[48px] px-8"
        >
          <Link href="/login">
            {t("finalCtaCta")} <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </Button>
      </motion.div>
    </section>
  );
}
