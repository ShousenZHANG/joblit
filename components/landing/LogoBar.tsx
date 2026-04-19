"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeIn, useReveal } from "./lib/motion";

// LogoBar — alternating serif-italic / sans render gives the marquee a
// magazine feel without requiring real company wordmarks. Logos are
// text-only on purpose (Landing.html uses text too) — swapping to real
// SVG wordmarks is a follow-up when legal sign-off lands.

const LOGOS = ["Stripe", "Linear", "Vercel", "Figma", "Notion", "Airbnb"];

export function LogoBar() {
  const reveal = useReveal();
  const t = useTranslations("landing.logoBar");
  return (
    <motion.section
      {...reveal}
      data-testid="landing-logobar"
      className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-10"
      variants={fadeIn}
    >
      <div className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {t("kicker")}
      </div>
      <ul
        className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-2xl text-foreground/60 sm:gap-x-14"
        role="list"
      >
        {LOGOS.map((logo, i) => (
          <li
            key={logo}
            className={
              "transition-colors duration-200 hover:text-foreground " +
              (i % 2 === 1 ? "font-serif italic" : "font-semibold")
            }
          >
            {logo}
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
