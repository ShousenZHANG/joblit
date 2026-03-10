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
  age: z.string().max(20).optional().nullable(),
  identity: z.string().max(60).optional().nullable(),
  availabilityMonth: z
    .union([z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), z.literal("")])
    .optional()
    .nullable(),
  wechat: z.string().max(40).optional().nullable(),
  qq: z.string().max(20).optional().nullable(),
});

export type CnResumeBasics = z.infer<typeof CnResumeBasicsSchema>;
