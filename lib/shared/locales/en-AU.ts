import type { LocaleProfile } from "./index";

export const enAU: LocaleProfile = {
  locale: "en-AU",
  label: "English (Australia)",
  coverWordRange: { min: 300, max: 400 },
  dateFormat: "D MMMM YYYY",
  dateExample: "5 February 2026",
  salutationStyle: "addressee only, no 'Dear', no trailing comma",
  toneRules: [
    "Australian workplace style: direct, concise, understated confidence.",
    "Avoid American corporate buzzwords (e.g. 'synergy', 'leverage' as verb, 'passionate' overuse).",
    "Prefer collaborative tone and outcomes over self-promotion; sound like a capable colleague, not a sales pitch.",
    "Big tech / enterprise standard: lead with evidence and fit; no generic openers.",
    "Keep paragraphs scannable: clear topic sentences, evidence before claims.",
    "Avoid superlatives ('extremely', 'incredibly'); use concrete outcomes and scope instead.",
  ],
};
