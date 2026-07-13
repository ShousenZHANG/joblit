import { z } from "zod";

/**
 * Shared Resume Profile Zod schemas — single source of truth.
 *
 * Superset of all fields used by:
 *   - app/api/resume-profile/route.ts
 *   - app/api/resume-pdf/route.ts
 *   - lib/shared/schemas/cnResumeBasics.ts (now subsumed)
 */

export const ResumeBasicsSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(3).max(40),
  location: z.string().trim().min(1).max(120).optional().nullable(),
  // Accepts valid URL or empty string (profiles may store "")
  photoUrl: z.union([z.string().url(), z.literal("")]).optional().nullable(),
  gender: z.string().max(10).optional().nullable(),
  age: z.string().max(20).optional().nullable(),
  identity: z.string().max(60).optional().nullable(),
  availabilityMonth: z
    .union([z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), z.literal("")])
    .optional()
    .nullable(),
  // CN-specific contact fields
  wechat: z.string().max(60).optional().nullable(),
  qq: z.string().max(20).optional().nullable(),
});

export const ResumeLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(300),
});

export const ResumeExperienceSchema = z.object({
  location: z.string().trim().min(1).max(120).optional().nullable(),
  dates: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(120),
  links: z.array(ResumeLinkSchema).max(2).optional().nullable(),
  bullets: z.array(z.string().trim().min(1).max(220)).max(12),
});

export const ResumeProjectSchema = z.object({
  name: z.string().trim().min(1).max(140),
  location: z.string().trim().min(1).max(120).optional().nullable(),
  dates: z.string().trim().min(1).max(80),
  stack: z.string().trim().max(300).optional().nullable(),
  links: z.array(ResumeLinkSchema).max(4).optional().nullable(),
  bullets: z.array(z.string().trim().min(1).max(220)).max(12),
});

export const ResumeEducationSchema = z.object({
  school: z.string().trim().min(1).max(140),
  degree: z.string().trim().min(1).max(140),
  location: z.string().trim().min(1).max(120).optional().nullable(),
  dates: z.string().trim().min(1).max(80),
  details: z.string().trim().max(200).optional().nullable(),
});

export const ResumeSkillSchema = z.object({
  category: z.string().trim().min(1).max(60),
  items: z.array(z.string().trim().min(1).max(60)).max(30),
});

export const ResumeProfileSchema = z.object({
  locale: z.string().optional().nullable(),
  summary: z.string().trim().min(1).max(2000).optional().nullable(),
  basics: ResumeBasicsSchema.optional().nullable(),
  links: z.array(ResumeLinkSchema).max(8).optional().nullable(),
  skills: z.array(ResumeSkillSchema).max(12).optional().nullable(),
  experiences: z.array(ResumeExperienceSchema).max(20).optional().nullable(),
  projects: z.array(ResumeProjectSchema).max(20).optional().nullable(),
  education: z.array(ResumeEducationSchema).max(10).optional().nullable(),
});

export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

/** Compatibility alias retained for API callers and schema regression tests. */
export const CnResumeBasicsSchema = ResumeBasicsSchema;
