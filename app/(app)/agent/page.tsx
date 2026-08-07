import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { getTranslations } from "next-intl/server";

import { authOptions } from "@/auth";
import { PageHeading } from "@/components/app-shell/PageHeading";
import { AgentTokenManager } from "./AgentTokenManager";
import { RunnerPresenceChip } from "@/components/agent/RunnerPresenceChip";
import { RunnerSetupCard } from "./RunnerSetupCard";

export const dynamic = "force-dynamic";

/** The origin the Runner should point at — this deployment, not a guess. */
async function resolveOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  if (!host) return "https://your-joblit-deployment";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1")
    ? "http"
    : "https";
  return `${protocol}://${host}`;
}

export default async function AgentPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/agent");
  const t = await getTranslations("agent");
  const origin = await resolveOrigin();

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col cosmos-panel rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden">
        <div className="shrink-0 px-4 pt-3 pb-2 lg:px-6 lg:pt-6 lg:pb-4">
          <PageHeading title={t("title")} description={t("subtitle")} actions={<RunnerPresenceChip />} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 lg:px-6 lg:pb-6">
          <RunnerSetupCard origin={origin} />
          <AgentTokenManager />
        </div>
      </section>
    </div>
  );
}
