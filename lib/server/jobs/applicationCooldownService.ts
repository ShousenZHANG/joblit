import { prisma } from "@/lib/server/prisma";
import {
  buildCooldownFilter,
  type ApplicationCooldownCandidate,
  type ApplicationCooldownRule,
} from "./applicationCooldown";

export interface ApplicationCooldownOptions {
  sameRoleDays?: number;
  now?: Date;
}

const ROLE_FAMILIES: ReadonlyArray<{
  family: string;
  pattern: RegExp;
}> = [
  {
    family: "machine-learning",
    pattern:
      /(?:\b(?:machine learning|ml|ai|llm|nlp)\b|机器学习|人工智能|算法工程|大模型)/i,
  },
  {
    family: "data",
    pattern: /(?:\b(?:data|analytics|bi|etl)\b|数据|分析工程|商业智能)/i,
  },
  {
    family: "backend",
    pattern:
      /(?:\b(?:back[ -]?end|server|java|golang|full[ -]?stack)\b|\.net|后端|服务端|全栈)/i,
  },
  {
    family: "frontend",
    pattern: /(?:\b(?:front[ -]?end|react|web ui)\b|前端)/i,
  },
  {
    family: "mobile",
    pattern: /(?:\b(?:mobile|ios|android|flutter)\b|移动端|安卓)/i,
  },
  {
    family: "platform",
    pattern:
      /(?:\b(?:platform|devops|sre|cloud|infrastructure|site reliability)\b|平台工程|云平台|基础设施|运维)/i,
  },
  {
    family: "security",
    pattern: /(?:\b(?:security|cyber|soc)\b|安全工程|网络安全)/i,
  },
  {
    family: "quality",
    pattern: /(?:\b(?:quality|qa|test automation|sdet)\b|测试工程|质量工程)/i,
  },
  {
    family: "product",
    pattern: /(?:\b(?:product manager|product owner)\b|产品经理|产品负责人)/i,
  },
  {
    family: "design",
    pattern: /(?:\b(?:designer|design|ux|ui)\b|设计师|交互设计|视觉设计)/i,
  },
];

export function inferApplicationRoleFamily(title: string): string | null {
  return ROLE_FAMILIES.find((entry) => entry.pattern.test(title))?.family ?? null;
}

/**
 * Build deterministic per-company rules from append-only APPLIED events.
 * Only events inside the policy window participate, preventing an old title
 * from being hidden because the user recently applied to a different role.
 */
export async function loadApplicationCooldownRules(
  userId: string,
  options: ApplicationCooldownOptions = {},
): Promise<ApplicationCooldownRule[]> {
  const now = options.now ?? new Date();
  const requestedDays = options.sameRoleDays ?? 30;
  const sameRoleDays = Number.isFinite(requestedDays)
    ? Math.max(0, Math.min(Math.trunc(requestedDays), 365))
    : 30;
  if (sameRoleDays === 0) return [];
  const since = new Date(now.getTime() - sameRoleDays * 86_400_000);
  const events = await prisma.applicationEvent.findMany({
    where: {
      userId,
      type: "STATUS_CHANGED",
      toStatus: "APPLIED",
      occurredAt: { gte: since, lte: now },
    },
    orderBy: { occurredAt: "desc" },
    take: 1_000,
    select: {
      occurredAt: true,
      companySnapshot: true,
      titleSnapshot: true,
      job: { select: { company: true, title: true } },
    },
  });

  const seenCompanyTitles = new Set<string>();
  const rules: ApplicationCooldownRule[] = [];
  for (const event of events) {
    const company =
      event.companySnapshot?.trim() ?? event.job?.company?.trim();
    const title = event.titleSnapshot?.trim() ?? event.job?.title.trim();
    if (!company || !title) continue;
    const key = `${company.normalize("NFKC").toLowerCase()}\u001f${title
      .normalize("NFKC")
      .toLowerCase()}`;
    // Events are newest-first. Keep each exact title's newest date; never let
    // a recent Backend application extend an older Platform title's window.
    if (seenCompanyTitles.has(key)) continue;
    seenCompanyTitles.add(key);
    const family = inferApplicationRoleFamily(title);
    rules.push({
      company,
      lastApplyDate: event.occurredAt,
      sameRoleDays,
      appliedTo: [title],
      crossRoleBucket: family ? [family] : [],
    });
  }

  return rules;
}

export async function buildUserCooldownFilter(
  userId: string,
  options: ApplicationCooldownOptions = {},
): Promise<(candidate: ApplicationCooldownCandidate) => boolean> {
  const now = options.now ?? new Date();
  const rules = await loadApplicationCooldownRules(userId, {
    ...options,
    now,
  });
  return buildCooldownFilter(rules, now);
}
