import { prisma } from "@/lib/server/prisma";
import { isAdminEmail } from "@/lib/server/auth/adminAccess";

const MAX_NOTE = 500;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type AccessReviewStatus = "APPROVED" | "REJECTED";

/**
 * Gate used by the NextAuth signIn callback. An email may sign in when it is:
 *   1. a configured admin (ADMIN_EMAILS), OR
 *   2. an APPROVED access request, OR
 *   3. already a User row — existing accounts are grandfathered so turning the
 *      invite gate on never locks out anyone who could already sign in.
 */
export async function isSignInAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = normalizeEmail(email);
  if (isAdminEmail(e)) return true;
  const [approved, existing] = await Promise.all([
    prisma.accessRequest.findFirst({
      where: { email: e, status: "APPROVED" },
      select: { id: true },
    }),
    prisma.user.findUnique({ where: { email: e }, select: { id: true } }),
  ]);
  return Boolean(approved || existing);
}

/**
 * Record an access request. Idempotent via the unique email: re-applying never
 * creates a duplicate and never downgrades an already-APPROVED row back to
 * PENDING (the update only touches an optional note).
 */
export async function submitAccessRequest(email: string, note?: string): Promise<void> {
  const e = normalizeEmail(email);
  const trimmedNote = note?.trim().slice(0, MAX_NOTE) || null;
  await prisma.accessRequest.upsert({
    where: { email: e },
    update: trimmedNote ? { note: trimmedNote } : {},
    create: { email: e, note: trimmedNote },
  });
}

export async function listAccessRequests() {
  return prisma.accessRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      email: true,
      status: true,
      note: true,
      createdAt: true,
      reviewedAt: true,
      reviewedByEmail: true,
    },
  });
}

export async function reviewAccessRequest(
  id: string,
  status: AccessReviewStatus,
  reviewerEmail: string,
) {
  return prisma.accessRequest.update({
    where: { id },
    data: {
      status,
      reviewedAt: new Date(),
      reviewedByEmail: normalizeEmail(reviewerEmail),
    },
    select: { id: true, email: true, status: true },
  });
}
