import { z } from "zod";

/**
 * Canonical job-discovery item accepted by ingestion boundaries.
 *
 * Python workers use snake_case while TypeScript adapters use camelCase. The
 * shared schema accepts both producer shapes and strips fields the ingestion
 * service does not understand.
 */
export const ImportJobItemSchema = z
  .object({
    job_url: z.string().trim().max(2048).url().optional(),
    jobUrl: z.string().trim().max(2048).url().optional(),
    title: z.string().trim().min(2).max(240),
    company: z.string().trim().max(240).optional().nullable(),
    location: z.string().trim().max(240).optional().nullable(),
    job_type: z.string().trim().max(80).optional().nullable(),
    jobType: z.string().trim().max(80).optional().nullable(),
    job_level: z.string().trim().max(80).optional().nullable(),
    jobLevel: z.string().trim().max(80).optional().nullable(),
    description: z.string().trim().max(60_000).optional().nullable(),
    salary: z.string().trim().max(240).optional().nullable(),
    work_arrangement: z.string().trim().max(80).optional().nullable(),
    workArrangement: z.string().trim().max(80).optional().nullable(),
    listing_date: z.string().trim().max(80).optional().nullable(),
    listingDate: z.string().trim().max(80).optional().nullable(),
    market: z.enum(["AU", "CN", "GLOBAL"]).optional().default("AU"),
    source: z.string().trim().max(60).optional().nullable(),
    site: z.string().trim().max(120).optional().nullable(),
  })
  .strip();

export type ImportJobItem = z.input<typeof ImportJobItemSchema>;
