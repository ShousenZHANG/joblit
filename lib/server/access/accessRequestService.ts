import { prisma } from "@/lib/server/prisma";
import { isAdminEmail } from "@/lib/server/auth/adminAccess";

const MAX_NOTE = 500;

// Internal: callers go through the exported helpers below.
function normalizeEmail(email: string): string {
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
  // Checked cheapest/safest first and short-circuited so the AccessRequest
  // table is only queried for a brand-new email. This keeps admins AND existing
  // users able to sign in even if the AccessRequest migration has not run yet on
  // a freshly-deployed environment (the gate degrades to "existing users only"
  // instead of breaking sign-in for everyone).
  if (isAdminEmail(e)) return true;
  const existing = await prisma.user.findUnique({ where: { email: e }, select: { id: true } });
  if (existing) return true;
  const approved = await prisma.accessRequest.findFirst({
    where: { email: e, status: "APPROVED" },
    select: { id: true },
  });
  return Boolean(approved);
}

/**
 * Whether an email is already cleared to sign in via the invite gate — a
 * configured admin OR an APPROVED request. Deliberately does NOT consider
 * existing User rows: the apply form uses this to route "already approved"
 * visitors straight to sign-in, and we don't want that path to reveal whether
 * an arbitrary email has an account (it only reveals invite-approval status,
 * which is low-sensitivity and rate-limited). The real boundary is the OAuth
 * signIn gate (isSignInAllowed), not this.
 */
export async function isApproved(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = normalizeEmail(email);
  if (isAdminEmail(e)) return true;
  const approved = await prisma.accessRequest.findFirst({
    where: { email: e, status: "APPROVED" },
    select: { id: true },
  });
  return Boolean(approved);
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
