import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/auth";
import { ResumeFormProvider } from "@/components/resume/ResumeContext";
import { ResumePageLayout } from "@/components/resume/ResumePageLayout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ResumePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/resume");
  const t = await getTranslations("resume");

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden">
        <div className="shrink-0 px-4 pt-3 pb-2 lg:px-6 lg:pt-6 lg:pb-4">
          <h1 className="text-lg font-semibold text-foreground lg:text-2xl">{t("masterResumes")}</h1>
          <p className="hidden sm:block text-sm text-muted-foreground">
            {t("masterResumesDesc")}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ResumeFormProvider>
            <ResumePageLayout />
          </ResumeFormProvider>
        </div>
      </section>
    </main>
  );
}
