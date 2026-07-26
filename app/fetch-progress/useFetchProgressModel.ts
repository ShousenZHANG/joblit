"use client";

import { useTranslations } from "next-intl";
import type {
  FetchRunLane,
  FetchRunStatus,
} from "@/app/FetchStatusContext";

const SOURCE_LABEL: Record<string, string> = {
  jobspy: "LinkedIn",
  seek: "Seek",
  nowcoder: "Nowcoder",
  global: "Global feeds",
};

export type FetchProgressModel = {
  isRunning: boolean;
  isPartial: boolean;
  incompleteSources: string[];
  statusLabel: string;
  statusTone: string;
  progressValue: number;
  progressValueText: string;
  isIndeterminate: boolean;
  liveAnnouncement: string;
};

type FetchProgressModelInput = {
  status: FetchRunStatus | null;
  importedCount: number;
  lanes: FetchRunLane[];
  elapsedSeconds: number;
};

export function fetchSourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

function incompleteSourceLabels(lanes: FetchRunLane[]): string[] {
  return lanes
    .filter((lane) => lane.status === "FAILED" || lane.status === "PARTIAL")
    .map((lane) => fetchSourceLabel(lane.source));
}

function progressFor(
  status: FetchRunStatus | null,
  elapsedSeconds: number,
): number {
  if (status === "SUCCEEDED" || status === "PARTIAL") return 100;
  if (status === "FAILED") return 0;
  if (status === "RUNNING") {
    return Math.min(92, 20 + Math.floor(elapsedSeconds * 2));
  }
  return 10;
}

function statusTone(status: FetchRunStatus | null): string {
  if (status === "FAILED") return "bg-destructive/10 text-destructive";
  if (status === "SUCCEEDED") {
    return "bg-brand-emerald-100 text-brand-emerald-text";
  }
  if (status === "PARTIAL") {
    return "bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]";
  }
  if (status === "RUNNING") {
    return "bg-[theme(colors.tier-good-bg)] text-[theme(colors.tier-good-fg)]";
  }
  return "bg-muted text-muted-foreground";
}

function statusMessageKey(status: FetchRunStatus | null) {
  if (status === "RUNNING") return "statusRunning" as const;
  if (status === "QUEUED") return "statusQueued" as const;
  if (status === "SUCCEEDED") return "statusCompleted" as const;
  if (status === "PARTIAL") return "statusPartial" as const;
  if (status === "FAILED") return "statusFailed" as const;
  return "statusStarting" as const;
}

export function useFetchProgressModel(
  input: FetchProgressModelInput,
): FetchProgressModel {
  const { status, importedCount, lanes, elapsedSeconds } = input;
  const t = useTranslations("fetchProgress");
  const isRunning = status === "RUNNING" || status === "QUEUED";
  const isPartial = status === "PARTIAL";
  const incompleteSources = incompleteSourceLabels(lanes);
  const statusLabel = t(statusMessageKey(status));
  const importedAnnouncement =
    importedCount > 0
      ? isRunning
        ? t("importedSoFar", { n: importedCount })
        : t("importedNew", { n: importedCount })
      : "";
  const sourceAnnouncement =
    incompleteSources.length === 0
      ? ""
      : isPartial
        ? t("partialNote", { sources: incompleteSources.join(", ") })
        : `${incompleteSources.join(", ")}: ${t("statusFailed")}`;
  const progressValue = progressFor(status, elapsedSeconds);
  const progressValueText = [statusLabel, importedAnnouncement].filter(Boolean).join(". ");
  return {
    isRunning,
    isPartial,
    incompleteSources,
    statusLabel,
    statusTone: statusTone(status),
    progressValue,
    progressValueText,
    isIndeterminate:
      status !== "SUCCEEDED" && !isPartial && status !== "FAILED",
    liveAnnouncement: [
      statusLabel,
      importedAnnouncement,
      sourceAnnouncement,
    ]
      .filter(Boolean)
      .join(". "),
  };
}
