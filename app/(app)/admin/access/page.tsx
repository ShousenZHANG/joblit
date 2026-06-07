import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { isAdminEmail } from "@/lib/server/auth/adminAccess";
import { AdminAccessClient } from "./AdminAccessClient";

export const metadata: Metadata = { title: "Access requests · Joblit" };

// Admin-only console for the invite gate. Double-gated: the (app) layout already
// requires a session; this additionally redirects anyone who is not a configured
// admin (ADMIN_EMAILS) away from the page. The API routes enforce the same check
// server-side, so this is UX, not the security boundary.
export default async function AdminAccessPage() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    redirect("/jobs");
  }
  return <AdminAccessClient />;
}
