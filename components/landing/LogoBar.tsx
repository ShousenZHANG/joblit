"use client";

import { motion } from "framer-motion";
import { revealUp, useReveal } from "./lib/motion";

// Capability strip — replaces the old fake text-wordmark "social proof"
// (rendering "Stripe"/"Linear" in our own font implied false endorsement
// and read as a skeleton-loading state). These are honest, verifiable
// product facts that double as the integration story.

const CAPABILITIES: Array<{ stat: string; label: string }> = [
  { stat: "8", label: "job boards" },
  { stat: "5", label: "ATS platforms" },
  { stat: "GPT · Claude · Gemini", label: "bring your own model" },
  { stat: "EN · 中文", label: "bilingual resumes" },
];

export function LogoBar() {
  const reveal = useReveal();
  return (
    <motion.section
      {...reveal}
      data-testid="landing-logobar"
      className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-10 sm:py-16"
      variants={revealUp}
    >
      <div className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">
        Plugs into your whole job hunt
      </div>
      <ul
        className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 sm:flex sm:flex-wrap sm:items-start sm:justify-center sm:gap-x-14"
        role="list"
      >
        {CAPABILITIES.map((cap) => (
          <li key={cap.label} className="flex flex-col items-center text-center">
            <span className="text-2xl font-bold tracking-tight text-foreground sm:text-[26px]">
              {cap.stat}
            </span>
            <span className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">
              {cap.label}
            </span>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
