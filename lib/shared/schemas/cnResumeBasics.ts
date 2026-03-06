import { z } from "zod";

export const CnResumeBasicsSchema = z.object({
  // Existing basics fields
  fullName: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(3).max(40),
  location: z.string().trim().min(1).max(120).optional().nullable(),

  // CN-specific optional fields
  photoUrl: z.union([z.string().url(), z.literal("")]).optional().nullable(),
  gender: z.string().max(10).optional().nullable(),
  birthDate: z.string().max(20).optional().nullable(),
  nativePlace: z.string().max(60).optional().nullable(),
  politicalStatus: z.string().max(20).optional().nullable(),
  maritalStatus: z.string().max(20).optional().nullable(),
  expectedSalary: z.string().max(40).optional().nullable(),
  availableDate: z.string().max(40).optional().nullable(),
  workYears: z.string().max(20).optional().nullable(),
});

export type CnResumeBasics = z.infer<typeof CnResumeBasicsSchema>;
