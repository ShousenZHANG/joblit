import { sanitizePromptText } from "@/lib/server/ai/sanitize";

export const RESUME_PROMPT_SNAPSHOT_LIMITS = {
  totalChars: 32_000,
  basics: {
    fullName: 120,
    title: 120,
  },
  summary: 2_000,
  /**
   * These must not sit below `ResumeProfileSchema.skills` (12 groups of 30).
   * Tailoring asks the model to pick skills by index out of this snapshot, so a
   * tighter cap here does not merely shorten the prompt — it makes the skills
   * past the cap permanently unselectable, silently, with no way for the user
   * to tell which of their own skills the tailoring could never reach.
   */
  skills: {
    entries: 12,
    category: 60,
    items: 30,
    item: 60,
  },
  experiences: {
    entries: 4,
    location: 120,
    dates: 80,
    title: 120,
    company: 120,
    bullets: 8,
    bullet: 220,
  },
  projects: {
    entries: 3,
    name: 140,
    location: 120,
    dates: 80,
    stack: 300,
    bullets: 6,
    bullet: 220,
  },
  education: {
    entries: 3,
    school: 140,
    degree: 140,
    location: 120,
    dates: 80,
    details: 200,
  },
} as const;

export type ResumePromptSnapshot = {
  basics?: {
    fullName?: string;
    title?: string;
  };
  summary?: string;
  skills?: Array<{
    category?: string;
    items: string[];
  }>;
  experiences?: Array<{
    location?: string;
    dates?: string;
    title?: string;
    company?: string;
    bullets: string[];
  }>;
  projects?: Array<{
    name?: string;
    location?: string;
    dates?: string;
    stack?: string;
    bullets: string[];
  }>;
  education?: Array<{
    school?: string;
    degree?: string;
    location?: string;
    dates?: string;
    details?: string;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function boundedText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizePromptText(value);
  if (!sanitized) return undefined;
  return sanitized.slice(0, maxChars);
}

function boundedStrings(value: unknown, maxItems: number, maxChars: number): string[] {
  const output: string[] = [];
  for (const item of asArray(value)) {
    const text = boundedText(item, maxChars);
    if (text) output.push(text);
    if (output.length === maxItems) break;
  }
  return output;
}

function compactObject<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

function trimToTotalLimit(snapshot: ResumePromptSnapshot): ResumePromptSnapshot {
  const output = structuredClone(snapshot);
  /**
   * Trimmed narrowest-value-first, and `skills` is deliberately absent.
   *
   * Tailoring asks the model to choose skills by their index in this snapshot,
   * so a trimmed skill is not merely missing context — it is a skill the
   * candidate owns that no tailoring can ever surface, with nothing telling
   * them which. Every other section is evidence the model reads, and reading
   * less of it degrades the summary rather than silently shrinking what the
   * document can contain. Skills are bounded to 12 groups of 30 short strings
   * upstream, so exempting them cannot run away.
   */
  const sectionOrder: Array<keyof Pick<
    ResumePromptSnapshot,
    "education" | "projects" | "experiences"
  >> = ["education", "projects", "experiences"];

  while (JSON.stringify(output).length > RESUME_PROMPT_SNAPSHOT_LIMITS.totalChars) {
    const section = sectionOrder.find((key) => (output[key]?.length ?? 0) > 0);
    if (!section) break;
    output[section]?.pop();
    if (output[section]?.length === 0) delete output[section];
  }

  if (JSON.stringify(output).length > RESUME_PROMPT_SNAPSHOT_LIMITS.totalChars && output.summary) {
    const excess = JSON.stringify(output).length - RESUME_PROMPT_SNAPSHOT_LIMITS.totalChars;
    output.summary = output.summary.slice(0, Math.max(0, output.summary.length - excess));
    if (!output.summary) delete output.summary;
  }

  return output;
}

export function buildResumePromptSnapshot(profile: unknown): ResumePromptSnapshot {
  const source = asRecord(profile);
  const basicsSource = asRecord(source.basics);
  const basics = compactObject({
    fullName: boundedText(
      basicsSource.fullName,
      RESUME_PROMPT_SNAPSHOT_LIMITS.basics.fullName,
    ),
    title: boundedText(basicsSource.title, RESUME_PROMPT_SNAPSHOT_LIMITS.basics.title),
  });

  const skills = asArray(source.skills)
    .slice(0, RESUME_PROMPT_SNAPSHOT_LIMITS.skills.entries)
    .map((item) => {
      const record = asRecord(item);
      const category = boundedText(
        record.category ?? record.label,
        RESUME_PROMPT_SNAPSHOT_LIMITS.skills.category,
      );
      const items = boundedStrings(
        record.items,
        RESUME_PROMPT_SNAPSHOT_LIMITS.skills.items,
        RESUME_PROMPT_SNAPSHOT_LIMITS.skills.item,
      );
      return compactObject({ category, items });
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const experiences = asArray(source.experiences)
    .slice(0, RESUME_PROMPT_SNAPSHOT_LIMITS.experiences.entries)
    .map((item) => {
      const record = asRecord(item);
      return compactObject({
        location: boundedText(
          record.location,
          RESUME_PROMPT_SNAPSHOT_LIMITS.experiences.location,
        ),
        dates: boundedText(record.dates, RESUME_PROMPT_SNAPSHOT_LIMITS.experiences.dates),
        title: boundedText(record.title, RESUME_PROMPT_SNAPSHOT_LIMITS.experiences.title),
        company: boundedText(record.company, RESUME_PROMPT_SNAPSHOT_LIMITS.experiences.company),
        bullets: boundedStrings(
          record.bullets,
          RESUME_PROMPT_SNAPSHOT_LIMITS.experiences.bullets,
          RESUME_PROMPT_SNAPSHOT_LIMITS.experiences.bullet,
        ),
      });
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const projects = asArray(source.projects)
    .slice(0, RESUME_PROMPT_SNAPSHOT_LIMITS.projects.entries)
    .map((item) => {
      const record = asRecord(item);
      return compactObject({
        name: boundedText(record.name, RESUME_PROMPT_SNAPSHOT_LIMITS.projects.name),
        location: boundedText(
          record.location,
          RESUME_PROMPT_SNAPSHOT_LIMITS.projects.location,
        ),
        dates: boundedText(record.dates, RESUME_PROMPT_SNAPSHOT_LIMITS.projects.dates),
        stack: boundedText(record.stack, RESUME_PROMPT_SNAPSHOT_LIMITS.projects.stack),
        bullets: boundedStrings(
          record.bullets,
          RESUME_PROMPT_SNAPSHOT_LIMITS.projects.bullets,
          RESUME_PROMPT_SNAPSHOT_LIMITS.projects.bullet,
        ),
      });
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const education = asArray(source.education)
    .slice(0, RESUME_PROMPT_SNAPSHOT_LIMITS.education.entries)
    .map((item) => {
      const record = asRecord(item);
      return compactObject({
        school: boundedText(record.school, RESUME_PROMPT_SNAPSHOT_LIMITS.education.school),
        degree: boundedText(record.degree, RESUME_PROMPT_SNAPSHOT_LIMITS.education.degree),
        location: boundedText(
          record.location,
          RESUME_PROMPT_SNAPSHOT_LIMITS.education.location,
        ),
        dates: boundedText(record.dates, RESUME_PROMPT_SNAPSHOT_LIMITS.education.dates),
        details: boundedText(record.details, RESUME_PROMPT_SNAPSHOT_LIMITS.education.details),
      });
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const snapshot = compactObject({
    basics,
    summary: boundedText(source.summary, RESUME_PROMPT_SNAPSHOT_LIMITS.summary),
    skills: skills.length ? skills : undefined,
    experiences: experiences.length ? experiences : undefined,
    projects: projects.length ? projects : undefined,
    education: education.length ? education : undefined,
  });

  return trimToTotalLimit(snapshot ?? {});
}
