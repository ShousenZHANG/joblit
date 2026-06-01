import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { getTranslations, getLocale } from "next-intl/server";
import { authOptions } from "@/auth";
import { PageHeading } from "@/components/app-shell/PageHeading";
import { uiLocaleToMarket } from "@/lib/shared/market";
import { FetchClient } from "./FetchClient";

export default async function FetchPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/fetch");
  // CN market search isn't supported yet — Fetch is hidden from the nav and
  // direct navigation redirects to the Resume workspace.
  if (uiLocaleToMarket(await getLocale()) === "CN") redirect("/resume");
  const t = await getTranslations("fetch");

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden">
        <div className="shrink-0 px-4 pt-3 pb-2 lg:px-6 lg:pt-6 lg:pb-4">
          <PageHeading
            title={t("searchRoles")}
            description="Find roles across LinkedIn, Seek, and more. Smart fetch expands to related titles."
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FetchClient />
        </div>
      </section>
    </main>
  );
}

