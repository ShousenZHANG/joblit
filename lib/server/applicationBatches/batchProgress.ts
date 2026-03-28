export type BatchProgress = {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export function taskProgressFromGroupBy(
  rows: Array<{ status: string; _count: { _all: number } }>,
): BatchProgress {
  const counts: BatchProgress = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    if (row.status === "PENDING") counts.pending = row._count._all;
    if (row.status === "RUNNING") counts.running = row._count._all;
    if (row.status === "SUCCEEDED") counts.succeeded = row._count._all;
    if (row.status === "FAILED") counts.failed = row._count._all;
    if (row.status === "SKIPPED") counts.skipped = row._count._all;
  }

  return counts;
}
