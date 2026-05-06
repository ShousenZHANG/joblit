import { Suspense } from "react";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getServerSession } from "next-auth/next";
import { getLocale } from "next-intl/server";
import { authOptions } from "@/auth";
import { JobsClient } from "./JobsClient";
import getQueryClient from "@/lib/getQueryClient";
import { listJobs } from "@/lib/server/jobs/jobListService";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLocaleToMarket, type Market } from "@/lib/shared/market";
import type { JobItem, JobsResponse } from "./types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function buildDefaultJobsQueryString(market: Market) {
  const sp = new URLSearchParams();
  sp.set("limit", "10");
  sp.set("market", market);
  sp.set("sort", "newest");
  return sp.toString();
}

function JobsListFallback() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 lg:h-full lg:overflow-hidden">
      <div className="rounded-3xl border-2 border-border/60 bg-background/85 p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.35)]">
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.9fr_auto] lg:items-end">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      <section className="grid flex-1 min-h-0 gap-3 lg:h-full lg:grid-cols-[380px_1fr]">
        <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-3xl border-2 border-border/60 bg-background/85 p-4">
          <Skeleton className="h-6 w-32" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </div>
        <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-3xl border-2 border-border/60 bg-background/85 p-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
      </section>
    </div>
  );
}

async function JobsListSection({
  userId,
  market,
}: {
  userId: string;
  market: Market;
}) {
  const queryClient = getQueryClient();
  const queryString = buildDefaultJobsQueryString(market);

  const result = await listJobs(userId, {
    limit: 10,
    sort: "newest",
    market,
  });

  const items: JobItem[] = result.items.map((it) => ({
    id: it.id,
    jobUrl: it.jobUrl,
    title: it.title,
    company: it.company,
    location: it.location,
    jobType: it.jobType,
    jobLevel: it.jobLevel,
    status: it.status as JobItem["status"],
    resumePdfUrl: it.resumePdfUrl,
    resumePdfName: it.resumePdfName,
    coverPdfUrl: it.coverPdfUrl,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  }));

  const jobsResponse: JobsResponse = {
    items,
    nextCursor: result.nextCursor,
    totalCount: result.totalCount,
    facets: result.facets,
  };

  queryClient.setQueryData(["jobs", queryString, null], jobsResponse);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <JobsClient initialItems={items} initialCursor={result.nextCursor} />
    </HydrationBoundary>
  );
}

export default async function JobsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/jobs");
  const userId = session.user.id;
  const market = uiLocaleToMarket(await getLocale());

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 lg:h-full lg:overflow-hidden">
      <Suspense fallback={<JobsListFallback />}>
        <JobsListSection userId={userId} market={market} />
      </Suspense>
    </main>
  );
}
