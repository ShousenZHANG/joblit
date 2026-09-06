import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/server/api/appError";

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable for an issued task, so reconnecting never revokes a running client.
 * Only its SHA-256 digest is stored. It is not a session or a general API key. */
export function issueTaskCapability(task: {
  id: string; userId: string; jobId: string; target: string; expiresAt: Date;
}): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new AppError({ code: "LOCAL_TASK_CONFIGURATION", status: 503, publicMessage: "Local generation is not configured." });
  return createHmac("sha256", secret).update(JSON.stringify([
    "joblit-local-tailoring-v1", task.id, task.userId, task.jobId, task.target, task.expiresAt.toISOString(),
  ])).digest("base64url");
}

export function validTaskCapability(token: string, expectedHash: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(digest(token), "hex"), Buffer.from(expectedHash, "hex"));
}
