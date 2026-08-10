import { createHash } from "node:crypto";

type EtagJobItem = {
  id: string;
  status: string;
  updatedAt: Date | string;
  applicationId?: string | null;
  resumePdfUrl?: string | null;
  resumePdfName?: string | null;
  coverPdfUrl?: string | null;
  /**
   * Live tailoring state. It changes without the Job row itself changing, so
   * leaving it out of the validator would make every poll answer 304 while the
   * badge on screen went stale.
   */
  tailoringState?: string | null;
};

type BuildJobsListEtagInput = {
  userId: string;
  cursor: string | null;
  nextCursor: string | null;
  filtersSignature: string;
  jobLevels: string[];
  items: EtagJobItem[];
  totalCount?: number;
};

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function buildJobsListEtag(input: BuildJobsListEtagInput): string {
  const itemsSignature = input.items
    .map((item) =>
      [
        item.id,
        item.status,
        toIso(item.updatedAt),
        item.applicationId ?? "",
        item.resumePdfUrl ?? "",
        item.resumePdfName ?? "",
        item.coverPdfUrl ?? "",
        item.tailoringState ?? "",
      ].join(":"),
    )
    .join("|");
  const levelsSignature = input.jobLevels.join("|");
  const payload = [
    input.userId,
    input.cursor ?? "start",
    input.nextCursor ?? "end",
    input.filtersSignature,
    levelsSignature,
    itemsSignature,
    String(input.totalCount ?? -1),
  ].join("::");
  const digest = createHash("sha1").update(payload).digest("base64url");
  return `W/"jobs:${digest}"`;
}

