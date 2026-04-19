import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/auth";
import { FetchClient } from "./FetchClient";

export default async function FetchPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/fetch");
  const t = await getTranslations("fetch");

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden">
        <div className="shrink-0 px-4 pt-3 pb-2 lg:px-6 lg:pt-6 lg:pb-4">
          <h1 className="text-lg font-semibold text-foreground lg:text-2xl">{t("searchRoles")}</h1>
          <p className="hidden sm:block text-sm text-muted-foreground">
            {t("searchRolesDesc") ?? "Find roles across LinkedIn, Seek, and more. Smart fetch expands to related titles."}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FetchClient />
        </div>
      </section>
    </main>
  );
}

