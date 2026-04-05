import { prisma } from "@/lib/server/prisma";

export interface CreateSubmissionInput {
  userId: string;
  jobId?: string;
  pageUrl: string;
  pageDomain: string;
  atsProvider?: string;
  formSignature: string;
  fieldValues: Record<string, string>;
  fieldMappings: Record<string, { source: string; profilePath?: string; confidence: number }>;
}

export async function createFormSubmission(input: CreateSubmissionInput) {
  return prisma.formSubmission.create({
    data: {
      userId: input.userId,
      jobId: input.jobId ?? null,
      pageUrl: input.pageUrl,
      pageDomain: input.pageDomain,
      atsProvider: input.atsProvider ?? null,
      formSignature: input.formSignature,
      fieldValues: input.fieldValues,
      fieldMappings: input.fieldMappings,
    },
  });
}

export interface ListSubmissionsParams {
  userId: string;
  pageDomain?: string;
  atsProvider?: string;
  formSignature?: string;
  limit?: number;
  offset?: number;
}

export async function listFormSubmissions(params: ListSubmissionsParams) {
  const { userId, pageDomain, atsProvider, formSignature, limit = 50, offset = 0 } = params;

  const where: Record<string, unknown> = { userId };
  if (pageDomain) where.pageDomain = pageDomain;
  if (atsProvider) where.atsProvider = atsProvider;
  if (formSignature) where.formSignature = formSignature;

  const [items, total] = await Promise.all([
    prisma.formSubmission.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        pageUrl: true,
        pageDomain: true,
        atsProvider: true,
        formSignature: true,
        fieldValues: true,
        fieldMappings: true,
        submittedAt: true,
        jobId: true,
      },
    }),
    prisma.formSubmission.count({ where }),
  ]);

  return { items, total };
}

export interface UpsertMappingRuleInput {
  userId: string;
  fieldSelector: string;
  fieldLabel?: string;
  atsProvider?: string;
  pageDomain?: string;
  profilePath: string;
  staticValue?: string;
  source?: string;
}

export async function upsertFieldMappingRule(input: UpsertMappingRuleInput) {
  const { userId, fieldSelector, atsProvider, pageDomain, ...rest } = input;

  return prisma.fieldMappingRule.upsert({
    where: {
      userId_fieldSelector_atsProvider_pageDomain: {
        userId,
        fieldSelector,
        atsProvider: atsProvider ?? "",
        pageDomain: pageDomain ?? "",
      },
    },
    create: {
      userId,
      fieldSelector,
      atsProvider: atsProvider ?? null,
      pageDomain: pageDomain ?? null,
      profilePath: rest.profilePath,
      fieldLabel: rest.fieldLabel ?? null,
      staticValue: rest.staticValue ?? null,
      source: rest.source ?? "user",
      confidence: 1.0,
      useCount: 1,
    },
    update: {
      profilePath: rest.profilePath,
      fieldLabel: rest.fieldLabel ?? undefined,
      staticValue: rest.staticValue ?? undefined,
      source: rest.source ?? "user",
      confidence: 1.0,
      useCount: { increment: 1 },
    },
  });
}

export interface ListMappingRulesParams {
  userId: string;
  atsProvider?: string;
  pageDomain?: string;
}

export async function listFieldMappingRules(params: ListMappingRulesParams) {
  const { userId, atsProvider, pageDomain } = params;

  const where: Record<string, unknown> = { userId };
  if (atsProvider) where.atsProvider = atsProvider;
  if (pageDomain) where.pageDomain = pageDomain;

  return prisma.fieldMappingRule.findMany({
    where,
    orderBy: [{ useCount: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      fieldSelector: true,
      fieldLabel: true,
      atsProvider: true,
      pageDomain: true,
      profilePath: true,
      staticValue: true,
      source: true,
      confidence: true,
      useCount: true,
      updatedAt: true,
    },
  });
}

export async function deleteFieldMappingRule(userId: string, ruleId: string) {
  return prisma.fieldMappingRule.deleteMany({
    where: { id: ruleId, userId },
  });
}

export async function updateFieldMappingRule(
  userId: string,
  ruleId: string,
  data: { profilePath?: string; staticValue?: string | null },
) {
  return prisma.fieldMappingRule.updateMany({
    where: { id: ruleId, userId },
    data,
  });
}
