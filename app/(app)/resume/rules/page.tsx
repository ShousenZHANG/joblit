import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Prompt rules management entry removed (Plan A).
 * Redirect to resume so bookmarks/old links still resolve.
 */
export default function ResumeRulesPage() {
  redirect("/resume");
}
