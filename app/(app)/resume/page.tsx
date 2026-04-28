import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { ResumeFormProvider } from "@/components/resume/ResumeContext";
import { ResumePageLayout } from "@/components/resume/ResumePageLayout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ResumePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/resume");

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden">
        <ResumeFormProvider>
          <ResumePageLayout />
        </ResumeFormProvider>
      </section>
    </main>
  );
}
