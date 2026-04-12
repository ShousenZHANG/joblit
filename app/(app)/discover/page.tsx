import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { DiscoverClient } from "./DiscoverClient";

export default async function DiscoverPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/discover");

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col rounded-3xl border-2 border-slate-900/10 bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden">
        <DiscoverClient />
      </section>
    </main>
  );
}
