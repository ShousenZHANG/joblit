// Shared types across the CN fetch pipeline. Kept separate from Prisma
// models so the adapters stay pure and unit-testable without a DB.

export type CnSource = "v2ex" | "github" | "rsshub";

/** Raw job discovered by an adapter before dedup / DB write. */
export interface RawCnJob {
  /** Absolute URL used for canonicalization + dedup. */
  jobUrl: string;
  title: string;
  company: string | null;
  location: string | null;
  /** "fulltime" / "contract" / "internship" / raw platform string — optional. */
  jobType: string | null;
  /** "junior" / "senior" / numeric years as string — optional. */
  jobLevel: string | null;
  description: string | null;
  /** ISO timestamp when the posting was created upstream. */
  publishedAt: string | null;
  /** Upstream source (for diagnostics). */
  source: CnSource;
}

export interface AdapterResult {
  source: CnSource;
  ok: boolean;
  jobs: RawCnJob[];
  /** Populated when ok=false — short message for logs. */
  error?: string;
}
