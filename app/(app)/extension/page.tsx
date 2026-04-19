import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/auth";
import { ExtensionTokenManager } from "./ExtensionTokenManager";
import { KnowledgeBase } from "./KnowledgeBase";
import { ArrowUpRight, Chrome } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ExtensionPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/extension");
  const t = await getTranslations("extension");

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col" data-guide-anchor="install_extension">
      <section className="flex h-full min-h-0 flex-1 flex-col rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden">
        <div className="shrink-0 px-4 pt-3 pb-2 lg:px-6 lg:pt-6 lg:pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground lg:text-2xl">
                {t("title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("subtitle")}
              </p>
            </div>
            <Link
              href="/get-extension"
              target="_blank"
              className="group relative flex shrink-0 items-center gap-2 rounded-xl border border-brand-emerald-200 bg-brand-emerald-50 px-4 py-2 text-sm font-semibold text-brand-emerald-800 shadow-sm transition-all duration-200 hover:border-brand-emerald-300 hover:bg-brand-emerald-100 hover:shadow-md"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-emerald-600 shadow-sm transition-transform duration-200 group-hover:scale-110">
                <Chrome className="h-3.5 w-3.5 text-white" />
              </span>
              <span className="hidden sm:inline">{t("installGuide")}</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-brand-emerald-500 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 lg:px-6 lg:pb-6">
          <ExtensionTokenManager />
          <KnowledgeBase />
        </div>
      </section>
    </main>
  );
}
