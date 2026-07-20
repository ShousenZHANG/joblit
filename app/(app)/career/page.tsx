import { redirect } from "next/navigation";

/** Compatibility redirect for existing bookmarks after Career workspace removal. */
export default function CareerPage() {
  redirect("/jobs");
}
