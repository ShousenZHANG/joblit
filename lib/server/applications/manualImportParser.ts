/**
 * Parsing and validation utilities for manual AI output import.
 * Extracted from manual-generate route to keep the handler focused on orchestration.
 */

import { z } from "zod";
import { escapeLatex } from "@/lib/server/latex/escapeLatex";

// ── Zod Schemas ──

export const ManualGenerateSchema = z.object({
  jobId: z.string().uuid(),
  target: z.enum(["resume", "cover"]),
  modelOutput: z.string().min(20).max(80000),
  promptMeta: z.object({
    ruleSetId: z.string().min(1),
    resumeSnapshotUpdatedAt: z.string().min(1),
    promptTemplateVersion: z.string().min(1).optional(),
    schemaVersion: z.string().min(1).optional(),
    skillPackVersion: z.string().min(1).optional(),
    promptHash: z.string().min(1).optional(),
  }),
});

const ResumeSkillAdditionSchema = z.object({
  category: z.string().trim().min(1).max(100),
  items: z.array(z.string().trim().min(1).max(120)).min(1).max(30),
});

const ResumeSkillGroupSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    items: z.array(z.string().trim().min(1).max(120)).min(1).max(40),
  })
  .transform((value) => ({
    label: (value.label ?? value.category ?? "").trim(),
    items: value.items,
  }))
  .refine((value) => value.label.length > 0, {
    message: "skillsFinal item must include label or category",
  });

const ResumeManualOutputSchema = z.object({
  cvSummary: z.string().trim().min(1).max(2000),
  latestExperience: z.object({
    bullets: z.array(z.string().trim().min(1).max(320)).min(1).max(15),
  }),
  skillsAdditions: z.array(ResumeSkillAdditionSchema).max(20).optional(),
  skillsFinal: z.array(ResumeSkillGroupSchema).min(1).max(20).optional(),
});

const CoverContentSchema = z.object({
  candidateTitle: z.string().trim().max(160).optional(),
  subject: z.string().trim().max(220).optional(),
  date: z.string().trim().max(80).optional(),
  salutation: z.string().trim().max(220).optional(),
  paragraphOne: z.string().trim().min(1).max(2000),
  paragraphTwo: z.string().trim().min(1).max(2000),
  paragraphThree: z.string().trim().min(1).max(2000),
  closing: z.string().trim().max(300).optional(),
  signatureName: z.string().trim().max(120).optional(),
});

const CoverManualOutputSchema = z.object({
  cover: CoverContentSchema,
});

export type ResumeManualOutput = z.infer<typeof ResumeManualOutputSchema>;
export type CoverManualOutput = z.infer<typeof CoverManualOutputSchema>;

// ── JSON Parsing ──

export function parseJsonCandidate(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;

  const parse = (value: string): unknown | null => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const extractFirstJsonObject = (value: string): string | null => {
    let inString = false;
    let escaped = false;
    let depth = 0;
    let start = -1;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (start < 0) {
        if (char === "{") {
          start = index;
          depth = 1;
          inString = false;
          escaped = false;
        }
        continue;
      }
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return value.slice(start, index + 1);
        }
      }
    }
    return null;
  };

  const direct = parse(text);
  if (direct) return direct;

  const repaired = text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, " ")
    .replace(/,\s*([}\]])/g, "$1");

  const repairedDirect = parse(repaired);
  if (repairedDirect) return repairedDirect;

  const fencedBlock = repaired.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fencedBlock) {
    const fromFence = parse(fencedBlock.trim());
    if (fromFence) return fromFence;
  }

  const firstJsonObject = extractFirstJsonObject(repaired);
  if (firstJsonObject) {
    const parsedObject = parse(firstJsonObject);
    if (parsedObject) return parsedObject;
  }

  return null;
}

// ── Resume Output Parsing ──

export function parseResumeManualOutput(raw: string): {
  data: ResumeManualOutput | null;
  issues: string[];
} {
  const candidate = parseJsonCandidate(raw);
  if (!candidate || typeof candidate !== "object") {
    return { data: null, issues: ["Payload is not valid JSON object."] };
  }

  const record = candidate as Record<string, unknown>;
  const latestExperienceCandidate =
    (record.latestExperience as unknown) ??
    (record.latest_experience as unknown) ??
    (record.latestExperienceBlock as unknown);

  const payload: Record<string, unknown> = {
    cvSummary:
      typeof record.cvSummary === "string"
        ? record.cvSummary
        : typeof record.cv_summary === "string"
          ? record.cv_summary
        : typeof record.summary === "string"
          ? record.summary
          : "",
    latestExperience:
      latestExperienceCandidate && typeof latestExperienceCandidate === "object"
        ? latestExperienceCandidate
        : Array.isArray(record.latestExperienceBullets)
          ? { bullets: record.latestExperienceBullets }
          : Array.isArray(record.latest_experience_bullets)
            ? { bullets: record.latest_experience_bullets }
          : undefined,
    skillsAdditions: Array.isArray(record.skillsAdditions) ? record.skillsAdditions : undefined,
    skillsFinal: Array.isArray(record.skillsFinal)
      ? record.skillsFinal
      : Array.isArray(record.skills_final)
        ? record.skills_final
      : Array.isArray(record.skills)
        ? record.skills
        : undefined,
  };

  const parsed = ResumeManualOutputSchema.safeParse(payload);
  if (parsed.success) return { data: parsed.data, issues: [] };
  return {
    data: null,
    issues: parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    }),
  };
}

// ── Cover Output Parsing ──

export function parseCoverManualOutput(raw: string): {
  data: CoverManualOutput | null;
  issues: string[];
} {
  const candidate = parseJsonCandidate(raw);
  if (!candidate || typeof candidate !== "object") {
    return { data: null, issues: ["Payload is not valid JSON object."] };
  }

  const record = candidate as Record<string, unknown>;
  const coverRecord =
    record.cover && typeof record.cover === "object" ? (record.cover as Record<string, unknown>) : record;

  const payload = {
    cover: {
      subject: typeof coverRecord.subject === "string" ? coverRecord.subject : undefined,
      candidateTitle:
        typeof coverRecord.candidateTitle === "string" ? coverRecord.candidateTitle : undefined,
      date: typeof coverRecord.date === "string" ? coverRecord.date : undefined,
      salutation: typeof coverRecord.salutation === "string" ? coverRecord.salutation : undefined,
      paragraphOne:
        typeof coverRecord.paragraphOne === "string"
          ? coverRecord.paragraphOne
          : typeof coverRecord.paragraph_1 === "string"
            ? coverRecord.paragraph_1
          : typeof coverRecord.p1 === "string"
            ? coverRecord.p1
            : "",
      paragraphTwo:
        typeof coverRecord.paragraphTwo === "string"
          ? coverRecord.paragraphTwo
          : typeof coverRecord.paragraph_2 === "string"
            ? coverRecord.paragraph_2
          : typeof coverRecord.p2 === "string"
            ? coverRecord.p2
            : "",
      paragraphThree:
        typeof coverRecord.paragraphThree === "string"
          ? coverRecord.paragraphThree
          : typeof coverRecord.paragraph_3 === "string"
            ? coverRecord.paragraph_3
          : typeof coverRecord.p3 === "string"
            ? coverRecord.p3
            : "",
      closing: typeof coverRecord.closing === "string" ? coverRecord.closing : undefined,
      signatureName:
        typeof coverRecord.signatureName === "string" ? coverRecord.signatureName : undefined,
    },
  };

  const parsed = CoverManualOutputSchema.safeParse(payload);
  if (parsed.success) return { data: parsed.data, issues: [] };
  return {
    data: null,
    issues: parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    }),
  };
}

// ── Skill Group Utilities ──

export function mergeSkillAdditions(
  base: Array<{ label: string; items: string[] }>,
  additions?: Array<{ category: string; items: string[] }>,
) {
  if (!additions || additions.length === 0) return base;
  const result = [...base.map((group) => ({ ...group, items: [...group.items] }))];

  for (const addition of additions) {
    const category = addition.category.trim();
    const incoming = addition.items.map((item) => item.trim()).filter(Boolean);
    if (!category || incoming.length === 0) continue;

    const targetIndex = result.findIndex(
      (group) => group.label.trim().toLowerCase() === category.toLowerCase(),
    );
    if (targetIndex >= 0) {
      const existingSet = new Set(result[targetIndex].items.map((item) => item.toLowerCase()));
      for (const item of incoming) {
        if (!existingSet.has(item.toLowerCase())) {
          result[targetIndex].items.push(item);
          existingSet.add(item.toLowerCase());
        }
      }
      continue;
    }

    result.push({ label: category, items: Array.from(new Set(incoming)) });
  }

  return result;
}

export function sanitizeSkillGroups(
  groups: Array<{ label: string; items: string[] }>,
): Array<{ label: string; items: string[] }> {
  const out: Array<{ label: string; items: string[] }> = [];
  const seenLabels = new Set<string>();

  for (const group of groups) {
    const rawLabel = group.label.trim();
    if (!rawLabel) continue;
    const labelKey = rawLabel.toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    seenLabels.add(labelKey);

    const seenItems = new Set<string>();
    const items = group.items
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seenItems.has(key)) return false;
        seenItems.add(key);
        return true;
      })
      .slice(0, 20)
      .map((item) => escapeLatex(item));

    if (items.length === 0) continue;
    out.push({ label: escapeLatex(rawLabel), items });
    if (out.length >= 5) break;
  }

  return out;
}

// ── Bullet Canonicalization ──

export function normalizeBulletForCompare(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeBulletForSimilarity(value: string) {
  return new Set(
    normalizeBulletForCompare(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

const BULLET_KEYWORD_STOPWORDS = new Set([
  "built", "build", "design", "designed", "develop", "developed",
  "deliver", "delivered", "lead", "led", "manage", "managed",
  "maintain", "maintained", "improve", "improved", "optimize", "optimized",
  "collaborate", "collaborated", "support", "supported", "work", "worked",
  "own", "owned", "drive", "drove", "using", "with", "for", "and",
  "the", "a", "an", "to", "of", "in", "on", "by",
]);

function extractMeaningfulKeywords(value: string) {
  return new Set(
    Array.from(tokenizeBulletForSimilarity(value)).filter(
      (token) => token.length >= 4 && !BULLET_KEYWORD_STOPWORDS.has(token),
    ),
  );
}

export function bulletSimilarityScore(a: string, b: string) {
  const ta = tokenizeBulletForSimilarity(a);
  const tb = tokenizeBulletForSimilarity(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const token of ta) {
    if (tb.has(token)) intersection += 1;
  }
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

export function isGroundedAddedBullet(addedBullet: string, baseBullets: string[]) {
  if (!addedBullet.trim()) return false;
  if (baseBullets.length === 0) return false;

  let bestScore = 0;
  let bestSharedTokens = 0;

  const addedTokens = new Set(
    Array.from(tokenizeBulletForSimilarity(addedBullet)).filter(
      (token) => !BULLET_KEYWORD_STOPWORDS.has(token),
    ),
  );
  if (addedTokens.size === 0) return false;

  for (const baseBullet of baseBullets) {
    bestScore = Math.max(bestScore, bulletSimilarityScore(addedBullet, baseBullet));
    const baseTokens = new Set(
      Array.from(tokenizeBulletForSimilarity(baseBullet)).filter(
        (token) => !BULLET_KEYWORD_STOPWORDS.has(token),
      ),
    );
    let shared = 0;
    for (const token of addedTokens) {
      if (baseTokens.has(token)) shared += 1;
    }
    bestSharedTokens = Math.max(bestSharedTokens, shared);
  }

  return bestSharedTokens >= 2 || bestScore >= 0.28;
}

export function isNonRedundantAddedBullet(
  addedBullet: string,
  baseBullets: string[],
  acceptedAddedBullets: string[],
) {
  const compareBullets = [...baseBullets, ...acceptedAddedBullets];
  if (compareBullets.length === 0) return true;

  for (const existing of compareBullets) {
    if (bulletSimilarityScore(addedBullet, existing) >= 0.62) {
      return false;
    }
  }

  const baseKeywords = new Set<string>();
  for (const existing of compareBullets) {
    for (const kw of extractMeaningfulKeywords(existing)) {
      baseKeywords.add(kw);
    }
  }

  const addedKeywords = extractMeaningfulKeywords(addedBullet);
  if (addedKeywords.size === 0) return false;

  let novelCount = 0;
  for (const kw of addedKeywords) {
    if (!baseKeywords.has(kw)) novelCount += 1;
  }

  const noveltyRatio = novelCount / addedKeywords.size;
  return novelCount >= 1 && noveltyRatio >= 0.25;
}

export function canonicalizeLatestBullets(baseBullets: string[], incomingBullets: string[]) {
  const normalizedBase = baseBullets.map(normalizeBulletForCompare);
  const usedBaseIndexes = new Set<number>();
  const canonicalBullets: string[] = [];
  const addedBullets: string[] = [];

  for (const incoming of incomingBullets) {
    const normalizedIncoming = normalizeBulletForCompare(incoming);
    let matchedIndex = -1;

    for (let i = 0; i < normalizedBase.length; i += 1) {
      if (usedBaseIndexes.has(i)) continue;
      if (normalizedBase[i] === normalizedIncoming) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex < 0) {
      let bestIndex = -1;
      let bestScore = 0;
      for (let i = 0; i < baseBullets.length; i += 1) {
        if (usedBaseIndexes.has(i)) continue;
        const score = bulletSimilarityScore(incoming, baseBullets[i]);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0 && bestScore >= 0.82) {
        matchedIndex = bestIndex;
      }
    }

    if (matchedIndex >= 0) {
      usedBaseIndexes.add(matchedIndex);
      canonicalBullets.push(baseBullets[matchedIndex]);
    } else {
      canonicalBullets.push(incoming);
      addedBullets.push(incoming);
    }
  }

  for (let i = 0; i < baseBullets.length; i += 1) {
    if (!usedBaseIndexes.has(i)) canonicalBullets.push(baseBullets[i]);
  }

  return { canonicalBullets, addedBullets };
}

export function normalizeMarkdownBold(value: string) {
  return value.replace(/\*\*([^*]+)\*\*/g, (_match, inner: string) => {
    const raw = inner ?? "";
    const leading = raw.match(/^\s*/)?.[0] ?? "";
    const trailing = raw.match(/\s*$/)?.[0] ?? "";
    const core = raw.trim();
    if (!core) return "";
    return `${leading}**${core}**${trailing}`;
  });
}

export function getLatestRawBullets(profile: unknown): string[] {
  if (!profile || typeof profile !== "object") return [];
  const record = profile as Record<string, unknown>;
  const experiences = Array.isArray(record.experiences) ? record.experiences : [];
  const latest =
    experiences.length > 0 && experiences[0] && typeof experiences[0] === "object"
      ? (experiences[0] as Record<string, unknown>)
      : null;
  const bullets = latest?.bullets;
  if (!Array.isArray(bullets)) return [];
  return bullets
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
