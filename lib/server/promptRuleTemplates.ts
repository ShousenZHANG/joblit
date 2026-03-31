import { prisma } from "@/lib/server/prisma";
import { DEFAULT_RULES, type PromptSkillRuleSet } from "@/lib/server/ai/promptSkills";

type TemplateRecord = {
  id: string;
  name: string;
  version: number;
  locale: string;
  cvRules: unknown;
  coverRules: unknown;
  hardConstraints: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PromptRuleTemplateInput = {
  name: string;
  cvRules: string[];
  coverRules: string[];
  hardConstraints: string[];
};

function normalizeRuleList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : fallback;
}

function toRuleSet(template: TemplateRecord): PromptSkillRuleSet {
  return {
    id: template.id,
    locale: "en-AU",
    cvRules: normalizeRuleList(template.cvRules, DEFAULT_RULES.cvRules),
    coverRules: normalizeRuleList(template.coverRules, DEFAULT_RULES.coverRules),
    hardConstraints: normalizeRuleList(template.hardConstraints, DEFAULT_RULES.hardConstraints),
  };
}

function normalizeTemplateInput(input: PromptRuleTemplateInput): PromptRuleTemplateInput {
  return {
    name: input.name.trim() || `Rules v${Date.now()}`,
    cvRules: normalizeRuleList(input.cvRules, DEFAULT_RULES.cvRules),
    coverRules: normalizeRuleList(input.coverRules, DEFAULT_RULES.coverRules),
    hardConstraints: normalizeRuleList(input.hardConstraints, DEFAULT_RULES.hardConstraints),
  };
}

async function getNextVersion(userId: string) {
  const latest = await prisma.promptRuleTemplate.findFirst({
    where: { userId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

async function ensureDefaultPromptRuleTemplate(userId: string) {
  const existing = await prisma.promptRuleTemplate.findFirst({
    where: { userId },
    orderBy: { version: "desc" },
  });
  if (existing) return existing;

  return prisma.promptRuleTemplate.create({
    data: {
      userId,
      name: "Default rules",
      version: 1,
      locale: DEFAULT_RULES.locale,
      cvRules: DEFAULT_RULES.cvRules,
      coverRules: DEFAULT_RULES.coverRules,
      hardConstraints: DEFAULT_RULES.hardConstraints,
      isActive: true,
    },
  });
}

export async function listPromptRuleTemplates(userId: string) {
  await ensureDefaultPromptRuleTemplate(userId);
  return prisma.promptRuleTemplate.findMany({
    where: { userId },
    orderBy: [{ version: "desc" }],
  });
}

export async function getActivePromptSkillRulesForUser(userId: string): Promise<PromptSkillRuleSet> {
  await ensureDefaultPromptRuleTemplate(userId);
  const active =
    (await prisma.promptRuleTemplate.findFirst({
      where: { userId, isActive: true },
      orderBy: { updatedAt: "desc" },
    })) ??
    (await prisma.promptRuleTemplate.findFirst({
      where: { userId },
      orderBy: { version: "desc" },
    }));

  if (!active) return DEFAULT_RULES;
  return toRuleSet(active as TemplateRecord);
}

export async function createPromptRuleTemplate(userId: string, input: PromptRuleTemplateInput) {
  const normalized = normalizeTemplateInput(input);
  const nextVersion = await getNextVersion(userId);
  return prisma.promptRuleTemplate.create({
    data: {
      userId,
      name: normalized.name,
      version: nextVersion,
      locale: DEFAULT_RULES.locale,
      cvRules: normalized.cvRules,
      coverRules: normalized.coverRules,
      hardConstraints: normalized.hardConstraints,
      isActive: false,
    },
  });
}

export async function activatePromptRuleTemplate(userId: string, templateId: string) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.promptRuleTemplate.findFirst({
      where: { id: templateId, userId },
      select: { id: true },
    });
    if (!found) return null;

    await tx.promptRuleTemplate.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
    return tx.promptRuleTemplate.update({
      where: { id: templateId },
      data: { isActive: true },
    });
  });
}

export async function resetPromptRulesToDefault(userId: string) {
  const nextVersion = await getNextVersion(userId);
  return prisma.$transaction(async (tx) => {
    await tx.promptRuleTemplate.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
    return tx.promptRuleTemplate.create({
      data: {
        userId,
        name: "Default rules",
        version: nextVersion,
        locale: DEFAULT_RULES.locale,
        cvRules: DEFAULT_RULES.cvRules,
        coverRules: DEFAULT_RULES.coverRules,
        hardConstraints: DEFAULT_RULES.hardConstraints,
        isActive: true,
      },
    });
  });
}
