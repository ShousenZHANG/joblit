import { z } from "zod";

export const JobStatusSchema = z.enum([
  "NEW",
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "ACCEPTED",
]);

export const JsonValueSchema: z.ZodType<
  null | boolean | number | string | unknown[] | Record<string, unknown>
> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const OptionalDateSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional()
  .nullable();

export const ApplicationEventCreateSchema = z
  .object({
    jobId: z.string().uuid(),
    applicationId: z.string().uuid().optional(),
    type: z
      .enum([
        "STATUS_CHANGED",
        "NOTE_ADDED",
        "INTERVIEW_PLANNED",
        "INTERVIEW_COMPLETED",
        "OFFER_RECORDED",
        "OFFER_UPDATED",
        "OFFER_DECIDED",
        "FOLLOW_UP_CREATED",
        "FOLLOW_UP_COMPLETED",
      ])
      .default("STATUS_CHANGED"),
    source: z.enum(["USER", "EXTENSION", "SYSTEM", "IMPORT"]).default("USER"),
    toStatus: JobStatusSchema.optional(),
    expectedFromStatus: JobStatusSchema.optional(),
    note: z.string().trim().max(4_000).optional(),
    metadata: z.record(z.string(), JsonValueSchema).optional(),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
    occurredAt: OptionalDateSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "STATUS_CHANGED" && !value.toStatus) {
      ctx.addIssue({
        code: "custom",
        path: ["toStatus"],
        message: "toStatus is required for STATUS_CHANGED",
      });
    }
    if (value.type !== "STATUS_CHANGED" && value.toStatus) {
      ctx.addIssue({
        code: "custom",
        path: ["toStatus"],
        message: "toStatus is only valid for STATUS_CHANGED",
      });
    }
    if (
      value.occurredAt &&
      value.occurredAt.getTime() > Date.now() + 5 * 60_000
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["occurredAt"],
        message: "occurredAt cannot be in the future",
      });
    }
  });

export const EvidenceCreateSchema = z
  .object({
    applicationId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    kind: z.enum([
      "RESUME_PROFILE",
      "JOB_DESCRIPTION",
      "APPLICATION_DRAFT",
      "USER_CLAIM",
      "STAR_STORY",
      "INTERVIEW_NOTE",
      "OFFER",
    ]),
    payload: z.record(z.string(), JsonValueSchema),
    sourceLabel: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const ClaimEvidenceCreateSchema = z
  .object({
    applicationId: z.string().uuid(),
    evidenceSnapshotId: z.string().regex(/^ev_[a-f0-9]{32}$/),
    claimKey: z.string().trim().min(1).max(200),
    claimText: z.string().trim().min(1).max(4_000),
    evidencePath: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const StarStoryCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    situation: z.string().trim().min(1).max(4_000),
    task: z.string().trim().min(1).max(4_000),
    action: z.string().trim().min(1).max(6_000),
    result: z.string().trim().min(1).max(4_000),
    reflection: z.string().trim().max(4_000).optional(),
    skills: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    sourceEvidenceId: z.string().regex(/^ev_[a-f0-9]{32}$/).optional(),
  })
  .strict();

export const StarStoryPatchSchema = StarStoryCreateSchema.partial().extend({
  id: z.string().uuid(),
});

export const InterviewPlanCreateSchema = z
  .object({
    jobId: z.string().uuid(),
    round: z.number().int().min(1).max(20).default(1),
    title: z.string().trim().min(1).max(200),
    scheduledAt: OptionalDateSchema,
    requirements: z.array(z.string().trim().min(1).max(1_000)).min(1).max(40),
    locale: z.enum(["en", "zh"]).default("en"),
    notes: z.string().trim().max(10_000).optional(),
  })
  .strict();

export const InterviewPlanPatchSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["DRAFT", "READY", "COMPLETED", "ARCHIVED"]).optional(),
    scheduledAt: OptionalDateSchema,
    notes: z.string().trim().max(10_000).optional().nullable(),
  })
  .strict();

const MoneySchema = z.number().int().min(0).max(2_000_000_000).optional().nullable();

export const OfferCreateSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    company: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(200),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase()).default("AUD"),
    baseSalaryAnnual: MoneySchema,
    bonusAnnual: MoneySchema,
    equityAnnual: MoneySchema,
    otherAnnual: MoneySchema,
    targetSalaryAnnual: MoneySchema,
    benefits: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
    location: z.string().trim().max(200).optional(),
    status: z.enum(["ACTIVE", "ACCEPTED", "DECLINED", "WITHDRAWN"]).default("ACTIVE"),
    receivedAt: OptionalDateSchema,
    deadlineAt: OptionalDateSchema,
    notes: z.string().trim().max(10_000).optional(),
  })
  .strict();

export const OfferPatchSchema = OfferCreateSchema.partial().extend({
  id: z.string().uuid(),
});

export const ReminderCreateSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    applicationId: z.string().uuid().optional(),
    type: z.enum([
      "APPLICATION_FOLLOW_UP",
      "INTERVIEW_THANK_YOU",
      "OFFER_DEADLINE",
      "CUSTOM",
    ]),
    title: z.string().trim().min(1).max(300),
    dueAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
    note: z.string().trim().max(4_000).optional(),
  })
  .strict();

export const ReminderPatchSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(300).optional(),
    dueAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
    note: z.string().trim().max(4_000).optional().nullable(),
    completed: z.boolean().optional(),
    dismissed: z.boolean().optional(),
  })
  .strict();
