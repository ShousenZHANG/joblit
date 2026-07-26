import type { TailoringRunSource } from "./tailoringRunProtocol";

export const APPLICATION_BATCH_TASK_LEASE_MS = (() => {
  const parsed = Number(process.env.APPLICATION_BATCH_TASK_STALE_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20 * 60 * 1000;
  return Math.max(parsed, 60_000);
})();

export function tailoringRunLeaseMs(source: TailoringRunSource): number {
  if (source === "MANUAL_IMPORT") return 2 * 60_000;
  if (source === "LOCAL_AI") return 5 * 60_000;
  return APPLICATION_BATCH_TASK_LEASE_MS;
}
