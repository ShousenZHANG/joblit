"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, stagger, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

// Pricing — 3 tiers matching Landing.html `.prices`. Featured card lifts
// on hover (and is visibly elevated at rest via shadow-elevated-emerald)
// so Pro stands out without fighting the other cards.

interface Tier {
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  cta: string;
  ctaHref: string;
  featured?: boolean;
}

export function Pricing() {
  const reveal = useReveal();
  const t = useTranslations("landing.pricing");
  const TIERS: Tier[] = [
    {
      name: t("starter.name"),
      price: t("starter.price"),
      cadence: t("starter.cadence"),
      blurb: t("starter.blurb"),
      features: [
        t("starter.f1"),
        t("starter.f2"),
        t("starter.f3"),
        t("starter.f4"),
      ],
      cta: t("starter.cta"),
      ctaHref: "/login",
    },
    {
      name: t("pro.name"),
      price: t("pro.price"),
      cadence: t("pro.cadence"),
      blurb: t("pro.blurb"),
      features: [
        t("pro.f1"),
        t("pro.f2"),
        t("pro.f3"),
        t("pro.f4"),
        t("pro.f5"),
      ],
      cta: t("pro.cta"),
      ctaHref: "/login",
      featured: true,
    },
    {
      name: t("byol.name"),
      price: t("byol.price"),
      cadence: t("byol.cadence"),
      blurb: t("byol.blurb"),
      features: [t("byol.f1"), t("byol.f2"), t("byol.f3"), t("byol.f4")],
      cta: t("byol.cta"),
      ctaHref: "/login",
    },
  ];
  return (
    <motion.section
      {...reveal}
      data-testid="landing-pricing"
      id="pricing"
      className="mx-auto w-full max-w-6xl px-6 py-24 sm:px-10"
      variants={fadeUp}
    >
      <div className="mb-14 text-center">
        <SectionKicker>{t("kicker")}</SectionKicker>
        <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t("titlePrefix")}{" "}
          <em className="font-serif italic text-brand-emerald-700">
            {t("titleItalic")}
          </em>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
          {t("lede")}
        </p>
      </div>

      <motion.ul
        variants={stagger}
        className="grid gap-6 md:grid-cols-3"
        role="list"
      >
        {TIERS.map((tier) => (
          <motion.li
            key={tier.name}
            variants={fadeUp}
            className={
              "relative flex flex-col rounded-2xl border p-6 transition-transform duration-300 hover:-translate-y-1 " +
              (tier.featured
                ? "border-brand-emerald/40 bg-gradient-to-b from-brand-emerald-50/80 to-background shadow-[0_20px_40px_-12px_rgba(5,150,105,0.18)] md:-translate-y-2"
                : "border-border/60 bg-background shadow-sm")
            }
          >
            {tier.featured && (
              <span className="absolute right-5 top-5 rounded-full bg-brand-emerald-600 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                {t("mostPopular")}
              </span>
            )}
            <div className="text-lg font-semibold text-foreground">
              {tier.name}
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight text-foreground">
                {tier.price}
              </span>
              <span className="text-sm text-muted-foreground">
                {tier.cadence}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{tier.blurb}</p>
            <ul className="mt-6 flex flex-1 flex-col gap-2.5">
              {tier.features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm text-foreground/90"
                >
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-600"
                    strokeWidth={3}
                    aria-hidden
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={tier.ctaHref}
              className={
                "mt-8 inline-flex h-10 w-full items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors " +
                (tier.featured
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "border border-border bg-background text-foreground hover:bg-muted")
              }
            >
              {tier.cta}
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </motion.section>
  );
}
