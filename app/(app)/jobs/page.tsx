import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { getLocale } from "next-intl/server";
import { authOptions } from "@/auth";
import { JobsClient } from "./JobsClient";
import { prisma } from "@/lib/server/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function JobsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/jobs");
  const userId = session.user.id;
  const locale = await getLocale();
  const market = locale === "zh" ? "CN" : "AU";

  const itemsRaw = await prisma.job.findMany({
    where: { userId, market },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 10,
    select: {
      id: true,
      jobUrl: true,
      title: true,
      company: true,
      location: true,
      jobType: true,
      jobLevel: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      applications: {
        select: { resumePdfUrl: true, resumePdfName: true, coverPdfUrl: true },
      },
    },
  });
  const items = itemsRaw.map(({ applications, ...it }) => ({
    ...it,
    resumePdfUrl: applications?.[0]?.resumePdfUrl ?? null,
    resumePdfName: applications?.[0]?.resumePdfName ?? null,
    coverPdfUrl: applications?.[0]?.coverPdfUrl ?? null,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  }));
  const nextCursor = items.length ? items[items.length - 1].id : null;

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 lg:h-full lg:overflow-hidden">
      <JobsClient initialItems={items} initialCursor={nextCursor} />
    </main>
  );
}
