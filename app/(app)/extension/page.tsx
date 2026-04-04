import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { ExtensionTokenManager } from "./ExtensionTokenManager";

export const dynamic = "force-dynamic";

export default async function ExtensionPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/extension");

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col rounded-3xl border-2 border-slate-900/10 bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden">
        <div className="shrink-0 px-4 pt-3 pb-2 lg:px-6 lg:pt-6 lg:pb-4">
          <h1 className="text-lg font-semibold text-slate-900 lg:text-2xl">
            Browser Extension
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your Jobflow AutoFill extension tokens and view submission
            history.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 lg:px-6 lg:pb-6">
          <ExtensionTokenManager />
        </div>
      </section>
    </main>
  );
}
