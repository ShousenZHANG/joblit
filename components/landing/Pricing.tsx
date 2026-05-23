"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { fadeUp, stagger, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

// Pricing — three tiers. Hover interaction is driven by framer-motion
// spring physics (stiffness 260 / damping 22) instead of CSS easing,
// so the lift lands with natural deceleration rather than a linear
// cubic-bezier curve. A hoveredIndex state dims the non-hovered
// siblings (opacity 0.7 + scale 0.98) so the cursor-focused card
// visually pops — the "spotlight" pattern used by Stripe / Vercel.

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

const HOVER_SPRING = {
  type: "spring" as const,
  stiffness: 260,
  damping: 22,
  mass: 0.7,
};

export function Pricing() {
  const reveal = useReveal();
  const t = useTranslations("landing.pricing");
  const [hovered, setHovered] = useState<number | null>(null);

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
          <em className="font-serif italic text-foreground">
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
        onMouseLeave={() => setHovered(null)}
      >
        {TIERS.map((tier, i) => {
          const isHovered = hovered === i;
          const isDimmed = hovered !== null && !isHovered;
          const baseY = tier.featured ? -8 : 0;
          const hoverY = tier.featured ? -16 : -10;

          return (
            <motion.li
              key={tier.name}
              variants={fadeUp}
              onHoverStart={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              animate={{
                y: isHovered ? hoverY : baseY,
                scale: isHovered ? 1.015 : isDimmed ? 0.985 : 1,
                opacity: isDimmed ? 0.7 : 1,
              }}
              transition={HOVER_SPRING}
              style={{ willChange: "transform" }}
              className={
                "group relative flex flex-col rounded-2xl border p-6 " +
                (tier.featured
                  ? "border-brand-emerald/40 bg-gradient-to-b from-brand-emerald-50/80 to-background shadow-[0_20px_40px_-12px_rgba(5,150,105,0.22)]"
                  : "border-border/60 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]")
              }
            >
              {/* Radial glow layer — fades in behind the card on hover,
                  gives premium depth without repainting the border. */}
              <motion.div
                aria-hidden
                animate={{ opacity: isHovered ? 1 : 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  background: tier.featured
                    ? "radial-gradient(120% 80% at 50% 0%, rgba(5,150,105,0.16), transparent 60%)"
                    : "radial-gradient(120% 80% at 50% 0%, rgba(5,150,105,0.12), transparent 55%)",
                  boxShadow: tier.featured
                    ? "0 36px 72px -28px rgba(5,150,105,0.38)"
                    : "0 28px 56px -24px rgba(5,150,105,0.28)",
                }}
              />

              {tier.featured && (
                <span className="absolute right-5 top-5 rounded-full bg-brand-emerald-600 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                  {t("mostPopular")}
                </span>
              )}

              <div className="relative text-lg font-semibold text-foreground">
                {tier.name}
              </div>

              {/* Price — subtle scale pop on card hover for tactile feel. */}
              <motion.div
                animate={{ scale: isHovered ? 1.04 : 1 }}
                transition={HOVER_SPRING}
                style={{ transformOrigin: "left center" }}
                className="relative mt-4 flex items-baseline gap-1"
              >
                <span className="text-4xl font-bold tracking-tight text-foreground">
                  {tier.price}
                </span>
                <span className="text-sm text-muted-foreground">
                  {tier.cadence}
                </span>
              </motion.div>

              <p className="relative mt-3 text-sm text-muted-foreground">
                {tier.blurb}
              </p>

              <ul className="relative mt-6 flex flex-1 flex-col gap-2.5">
                {tier.features.map((f, fIdx) => (
                  <motion.li
                    key={f}
                    animate={{ x: isHovered ? 2 : 0 }}
                    transition={{
                      ...HOVER_SPRING,
                      delay: isHovered ? fIdx * 0.025 : 0,
                    }}
                    className="flex items-start gap-2 text-sm text-foreground/90"
                  >
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-600"
                      strokeWidth={3}
                      aria-hidden
                    />
                    <span>{f}</span>
                  </motion.li>
                ))}
              </ul>

              <Link
                href={tier.ctaHref}
                className={
                  "relative mt-8 inline-flex h-10 w-full items-center justify-center rounded-full px-5 text-sm font-semibold transition-[background-color,border-color,box-shadow,color] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] " +
                  (tier.featured
                    ? "bg-foreground text-background shadow-sm hover:bg-foreground/90 hover:shadow-md"
                    : "border border-border bg-background text-foreground hover:border-brand-emerald-300 hover:bg-muted group-hover:border-brand-emerald-200")
                }
              >
                {tier.cta}
              </Link>
            </motion.li>
          );
        })}
      </motion.ul>
    </motion.section>
  );
}
