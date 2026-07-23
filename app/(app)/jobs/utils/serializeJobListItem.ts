import { toActiveJobStatus } from "@/lib/shared/jobStatus";
import type { JobListItem } from "@/lib/server/jobs/jobListService";
import type { JobItem } from "../types";

/**
 * Keep the server-rendered first page byte-for-byte compatible with the
 * client-fetched pages. A single explicit serializer prevents new list fields
 * from silently disappearing during React Query hydration.
 */
export function serializeJobListItem(item: JobListItem): JobItem {
  return {
    id: item.id,
    jobUrl: item.jobUrl,
    title: item.title,
    company: item.company,
    location: item.location,
    jobType: item.jobType,
    jobLevel: item.jobLevel,
    salary: item.salary,
    workArrangement: item.workArrangement,
    listingDate: item.listingDate?.toISOString() ?? null,
    // ADR-0007: read the stored value through the projection rather than
    // casting it. A row the migration missed would otherwise render a badge no
    // filter can select.
    status: toActiveJobStatus(item.status),
    market: item.market,
    source: item.source,
    postingRisk: item.postingRisk,
    postingRiskFlags: item.postingRiskFlags,
    fitScore: item.fitScore,
    fitVerdict: item.fitVerdict,
    fitEligibility: item.fitEligibility,
    livenessStatus: item.livenessStatus,
    livenessReason: item.livenessReason,
    possibleDuplicate: item.possibleDuplicate,
    resumePdfUrl: item.resumePdfUrl,
    resumePdfName: item.resumePdfName,
    coverPdfUrl: item.coverPdfUrl,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
