type SkillRuleDef = {
  id: string;
  category: "grounding" | "structure" | "content" | "style" | "ats" | "coverage" | "locale";
  priority: "critical" | "high" | "normal";
  text: string;
  appliesTo: ("resume" | "cover")[];
  locale?: "en-AU" | "zh-CN" | "all";
};

export const DEFAULT_CV_RULES = [
  // ── Grounding (critical) ──
  "Tailor the candidate's existing resume to the role: adapt and reorder their content; add new bullets only when grounded in their resume. Do not invent a new profile.",
  "Act as a FAANG Senior Technical Recruiter who reviews 200+ resumes daily. Prioritize role-fit evidence, impact clarity, and ATS keyword alignment. Reject anything that would not survive a 6-second recruiter scan.",
  "Do not add claims beyond the base resume experience. Keep every statement grounded in provided resume context.",
  "Keep every latest experience bullet grounded in base resume facts and technologies; no fabricated scope, systems, or outcomes.",
  "Do not invent numeric metrics. If metrics are unavailable, surface truthful qualitative outcomes using this priority: (1) scale/scope (users, services, team size), (2) speed/efficiency gains, (3) reliability/quality improvements, (4) stakeholder or business impact.",
  "If evidence is insufficient for a JD point, do not add a speculative bullet for that point.",
  "For newly added bullets, avoid reusing the same primary tech stack already emphasized in existing latest-experience bullets; prioritize complementary JD-required skills not yet covered.",
  "If a JD must-have has no grounded evidence in base resume context, use the closest truthful transferable skill and never fabricate direct ownership.",
  "Keep skills plausible and role-consistent; avoid fabricated project claims or impossible seniority signals.",

  // ── Summary (high) ──
  "Rewrite cvSummary using this formula: {Role-aligned identity} + {years/scope} + {2-3 core strengths mapped to top JD requirements} + {signature achievement with measurable outcome}. Example: 'Platform-focused engineer with 6+ years delivering cloud-native services; led Kubernetes migration for 200-service platform, improving deploy frequency by 40%.'",
  "Preserve the base summary length (+/-10% chars) and sentence count. If the base summary is weak or generic, strengthen it within the same length using the formula above.",
  "Bold 3-5 JD-aligned technical keywords in summary using markdown **keyword** format. Over-bolding reduces readability.",
  "When using markdown bold, keep markers clean: use **keyword** (no leading/trailing spaces inside ** **).",

  // ── Bullet Content (high) ──
  "Return latestExperience.bullets as the COMPLETE final bullet list for the latest experience block (full ordered output, not delta).",
  "Reorder latest experience bullets to mirror JD responsibilities order. Place the most JD-relevant bullets first — recruiters read top-down and may stop after 4-5 bullets.",
  "Do not rewrite or paraphrase any existing latest experience bullet; preserve original text verbatim and only change order.",
  "Any new bullet must follow Google XYZ style: 'Achieved [X measurable outcome] by [Y specific action], resulting in [Z business impact]' (or equivalent qualitative outcome when metrics are unavailable).",
  "Use strong, specific action verbs for new bullets. Prefer: Led, Architected, Shipped, Designed, Migrated, Optimized, Automated, Implemented, Drove, Delivered. Avoid weak verbs: Helped, Assisted, Worked on, Was responsible for, Participated in, Supported.",
  "Each new bullet must introduce at least one meaningfully different JD-relevant concept. If two bullets would cover the same theme (e.g., both about 'performance optimization'), keep only the stronger one.",
  "Quantification strategy for new bullets: mine the resume snapshot for real numbers first (users served, services managed, team size, uptime %, latency reduction). Only fall back to qualitative outcomes when no numbers exist anywhere in the snapshot.",
  "Keep any new bullet similar in length to nearby bullets (+/-20%) and consistent with the resume tone.",
  "Before final output, self-check: (1) all base bullets are preserved verbatim, (2) any additions are grounded, (3) no two bullets cover the same theme, (4) output remains concise and role-relevant.",

  // ── Bullet Coverage (high) ──
  "When top-3 JD responsibilities are under-covered and grounded evidence exists, add at least 2 and at most 3 new bullets.",
  "Prioritize uncovered top-3 JD responsibilities first for new bullets.",
  "If a top-3 responsibility needs unsupported tech, do not fabricate it; instead use other JD responsibilities or adjacent proven technologies to complete the first 2 additions when possible.",
  "Prefer placing newly added bullets before reordered base bullets in the same responsibility order they address.",
  "If a base bullet is completely irrelevant to the target role and could hurt candidacy (e.g., 'designed marketing flyers' when applying for backend engineer), flag it in output comments but still include it to preserve verbatim rule. The user can decide to remove it.",

  // ── Bullet Style (high) ──
  "For every newly added bullet, bold at least one JD-critical keyword using markdown **keyword** format.",
  "For every newly added bullet, keep markdown bold markers syntactically clean (valid: **keyword**, invalid: **keyword ** or ** keyword**).",

  // ── Skills (high) ──
  "Return skillsFinal as the COMPLETE final skills list (not delta), with max 5 major categories.",
  "Prioritize JD must-have technologies in skillsFinal for ATS matching when grounded in base resume context.",
  "You may add missing JD-critical skills and freely re-group/re-order categories/items while preserving important base skills.",
  "Order skillsFinal by JD relevance priority (most important categories/items first) and keep category count <= 5.",
  "Do not return skillsAdditions; return skillsFinal only.",

  // ── Output Format (critical) ──
  "Resume target output keys allowed: cvSummary, latestExperience, skillsFinal only.",
  "Prefer concrete, ATS-safe phrasing. Avoid hype, fluff, or repeated adjectives.",
];

export const DEFAULT_COVER_RULES = [
  // ── Grounding (critical) ──
  "Generate the cover letter from the candidate's resume only; every claim must be grounded in their experience. Do not invent employers, projects, or skills.",
  "Do not fabricate employers, tools, projects, metrics, or domain exposure. Every claim must trace back to a specific entry in the resume snapshot.",
  "If direct evidence is missing for a JD point, do not claim it; use adjacent proven experience only when factually supportable. Frame skill gaps honestly: 'While my experience is in X, the underlying principles transfer directly to Y' — never pretend you have the skill.",
  "Write in natural first-person candidate voice (not recruiter voice, not AI-generic tone). The letter must sound like a real person wrote it, not a template engine.",

  // ── Structure (critical) ──
  "Return output under cover object only.",
  "Use three semantic sections mapped to paragraphOne/paragraphTwo/paragraphThree. Each section should be substantial, natural, and specific; avoid one-line generic statements.",
  "Include and populate these fields when possible: candidateTitle, subject, date, salutation, closing, signatureName.",
  "candidateTitle should align with the JD role title (not a fixed generic title).",
  "Subject should be concise and role-focused (prefer 'Application for <Role>'); do not append candidate name.",
  "Salutation should contain addressee text only (no leading 'Dear', no trailing comma).",
  "Cover target output keys allowed: cover only.",

  // ── Paragraph 1: Application Intent (high) ──
  "Paragraph 1 (Application intent): state target role and role-fit in one to two sentences; anchor in real experience (e.g., 'My recent work in X at Y has given me...'). No 'I am excited to apply', 'I am writing to express my interest', or similar filler. Open with what you bring, not what you want.",
  "Paragraph 1 must pass the 'so what' test — after reading it, the recruiter should immediately understand why this candidate is worth reading further.",

  // ── Paragraph 2: Evidence Mapping (high) ──
  "Paragraph 2 (Evidence mapping): map experience to JD responsibilities in priority order, using concrete evidence and delivery outcomes. Lead with what you did and the result; keep recruiter scanability in mind.",
  "Paragraph 2 must cover the top JD responsibilities first using only evidence grounded in the base resume context. Use the format: '[What I did] + [How/Context] + [Measurable result]' for each evidence point.",
  "Top-3 JD responsibilities must be addressed explicitly first; mirror JD priority order for recruiter scanability.",
  "Quantify outcomes in paragraph 2 wherever the resume provides numbers. Mine the snapshot for: team sizes, user counts, latency reductions, efficiency gains, revenue impact, system scale. Qualitative outcomes are acceptable only when no numbers exist.",

  // ── Paragraph 3: Motivation + Forward Contribution (high) ──
  "Paragraph 3 (Motivation + Forward Contribution): two parts — (a) why this role/company, citing one or two specific points about the team, product, mission, or growth area; (b) what you will contribute in the first 90 days or how your specific experience maps to their current challenges. Natural first-person; avoid 'I would be a great fit' or generic enthusiasm.",
  "Paragraph 3 must include a forward-looking contribution statement. Not just 'I like your company' but 'I'd bring X capability to help with Y challenge.' Example: 'I'd welcome the chance to apply my platform migration experience to your infrastructure modernisation goals.'",
  "If the JD mentions company values, culture, or mission, echo one specific value naturally in paragraph 3. Do not list values — weave one into your narrative authentically.",

  // ── Call to Action (high) ──
  "The closing sentence of paragraph 3 must include a clear, professional call to action. Prefer: 'I'd welcome the opportunity to discuss how my experience maps to your priorities' or 'Happy to walk through specific examples in more detail.' Avoid passive endings like 'I hope to hear from you' or 'Thank you for your consideration.'",

  // ── Locale & Tone (normal) ──
  "Australian workplace style (en-AU): write in natural Australian English — direct, concise, understated confidence. Avoid American corporate buzzwords (e.g., 'synergy', 'leverage' as verb, 'passionate' overuse). Prefer collaborative tone and outcomes over self-promotion; sound like a capable colleague, not a sales pitch.",
  "Big tech / enterprise standard: lead with evidence and fit; no generic openers. Keep paragraphs scannable: clear topic sentences, evidence before claims. Avoid superlatives ('extremely', 'incredibly'); use concrete outcomes and scope instead. Sound human and specific, not templated or AI-generic.",
  "Keep tone professional but natural: Australian workplace norm is slightly more direct and less formal than UK; avoid stiff or flowery language. One concise engaging line is fine; no slang or jokes.",

  // ── Style (high) ──
  "Bold 4-6 JD-critical keywords across the three paragraphs using markdown **keyword** format. Spread bolding evenly — do not cluster all bold terms in one paragraph. Over-bolding reduces readability.",
  "Keep markdown bold markers clean: **keyword** (no spaces inside markers).",
  "Write as a strong candidate narrative (clear, confident, specific), not recruiter boilerplate.",

  // ── Word Count & Quality (high) ──
  "Target 300-400 words total across the three paragraphs. Senior/Staff-level roles warrant the upper range; junior roles the lower range. Never exceed 450 or go below 250.",
  "Keep language application-ready with concrete wording, not hype or filler. Every sentence must earn its place — if removing a sentence would not reduce the recruiter's understanding of your fit, remove it.",
];

/* ── V2 Structured Rules ── */

/* ── V2 Structured CV Rules (maps to upgraded DEFAULT_CV_RULES indices) ── */
export const STRUCTURED_CV_RULES: SkillRuleDef[] = [
  // grounding (critical) — indices 0-8
  { id: "cv.grounding.01", category: "grounding", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[0] },
  { id: "cv.grounding.02", category: "grounding", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[2] },
  { id: "cv.grounding.03", category: "grounding", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[3] },
  { id: "cv.grounding.04", category: "grounding", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[4] },
  { id: "cv.grounding.05", category: "grounding", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[5] },
  { id: "cv.grounding.06", category: "grounding", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[6] },
  { id: "cv.grounding.07", category: "grounding", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[7] },
  { id: "cv.grounding.08", category: "grounding", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[8] },

  // ats (high) — index 1
  { id: "cv.ats.01", category: "ats", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[1] },

  // summary (high) — indices 9-12
  { id: "cv.content.01", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[9] },
  { id: "cv.content.02", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[10] },
  { id: "cv.style.01", category: "style", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[11] },
  { id: "cv.style.02", category: "style", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[12] },

  // bullet content (high) — indices 13-21
  { id: "cv.structure.01", category: "structure", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[13] },
  { id: "cv.content.03", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[14] },
  { id: "cv.content.04", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[15] },
  { id: "cv.content.05", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[16] },
  { id: "cv.content.06", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[17] },
  { id: "cv.content.07", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[18] },
  { id: "cv.content.08", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[19] },
  { id: "cv.content.09", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[20] },
  { id: "cv.content.10", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[21] },

  // bullet coverage (high) — indices 22-26
  { id: "cv.coverage.01", category: "coverage", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[22] },
  { id: "cv.coverage.02", category: "coverage", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[23] },
  { id: "cv.coverage.03", category: "coverage", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[24] },
  { id: "cv.coverage.04", category: "coverage", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[25] },
  { id: "cv.coverage.05", category: "coverage", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[26] },

  // bullet style (high) — indices 27-28
  { id: "cv.style.03", category: "style", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[27] },
  { id: "cv.style.04", category: "style", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[28] },

  // skills (high) — indices 29-33
  { id: "cv.structure.02", category: "structure", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[29] },
  { id: "cv.ats.02", category: "ats", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[30] },
  { id: "cv.content.11", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[31] },
  { id: "cv.content.12", category: "content", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[32] },
  { id: "cv.structure.03", category: "structure", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[33] },

  // output format (critical) — indices 34-35
  { id: "cv.structure.04", category: "structure", priority: "critical", appliesTo: ["resume"], text: DEFAULT_CV_RULES[34] },
  { id: "cv.style.05", category: "style", priority: "high", appliesTo: ["resume"], text: DEFAULT_CV_RULES[35] },
];

/* ── V2 Structured Cover Rules (maps to upgraded DEFAULT_COVER_RULES indices) ── */
export const STRUCTURED_COVER_RULES: SkillRuleDef[] = [
  // grounding (critical) — indices 0-3
  { id: "cover.grounding.01", category: "grounding", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[0] },
  { id: "cover.grounding.02", category: "grounding", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[1] },
  { id: "cover.grounding.03", category: "grounding", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[2] },
  { id: "cover.grounding.04", category: "grounding", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[3] },

  // structure (critical) — indices 4-10
  { id: "cover.structure.01", category: "structure", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[4] },
  { id: "cover.structure.02", category: "structure", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[5] },
  { id: "cover.structure.03", category: "structure", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[6] },
  { id: "cover.structure.04", category: "structure", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[7] },
  { id: "cover.structure.05", category: "structure", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[8] },
  { id: "cover.structure.06", category: "structure", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[9] },
  { id: "cover.structure.07", category: "structure", priority: "critical", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[10] },

  // paragraph 1 content (high) — indices 11-12
  { id: "cover.content.01", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[11] },
  { id: "cover.content.02", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[12] },

  // paragraph 2 content + coverage (high) — indices 13-16
  { id: "cover.content.03", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[13] },
  { id: "cover.content.04", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[14] },
  { id: "cover.coverage.01", category: "coverage", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[15] },
  { id: "cover.content.05", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[16] },

  // paragraph 3 motivation + forward contribution (high) — indices 17-19
  { id: "cover.content.06", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[17] },
  { id: "cover.content.07", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[18] },
  { id: "cover.content.08", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[19] },

  // call to action (high) — index 20
  { id: "cover.content.09", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[20] },

  // locale (normal) — indices 21-23
  { id: "cover.locale.01", category: "locale", priority: "normal", appliesTo: ["cover"], locale: "en-AU", text: DEFAULT_COVER_RULES[21] },
  { id: "cover.locale.02", category: "locale", priority: "normal", appliesTo: ["cover"], locale: "en-AU", text: DEFAULT_COVER_RULES[22] },
  { id: "cover.locale.03", category: "locale", priority: "normal", appliesTo: ["cover"], locale: "en-AU", text: DEFAULT_COVER_RULES[23] },

  // style (high) — indices 24-26
  { id: "cover.style.01", category: "style", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[24] },
  { id: "cover.style.02", category: "style", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[25] },
  { id: "cover.style.03", category: "style", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[26] },

  // word count + quality (high) — indices 27-28
  { id: "cover.content.10", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[27] },
  { id: "cover.content.11", category: "content", priority: "high", appliesTo: ["cover"], text: DEFAULT_COVER_RULES[28] },
];

export const STRUCTURED_HARD_CONSTRAINTS: SkillRuleDef[] = [
  { id: "hard.json", category: "structure", priority: "critical", appliesTo: ["resume", "cover"], text: "Return JSON only (no code fences, no markdown prose outside JSON). Markdown bold markers inside JSON string values are allowed when explicitly requested." },
  { id: "hard.no-latex", category: "structure", priority: "critical", appliesTo: ["resume", "cover"], text: "Do not output LaTeX in model response." },
  { id: "hard.no-fabrication", category: "grounding", priority: "critical", appliesTo: ["resume", "cover"], text: "Never invent skills, tools, metrics, employers, or responsibilities not in provided context." },
  { id: "hard.conservative", category: "grounding", priority: "critical", appliesTo: ["resume", "cover"], text: "If JD responsibilities or required skills are unclear, keep edits conservative and only add content when grounded in provided context." },
];
