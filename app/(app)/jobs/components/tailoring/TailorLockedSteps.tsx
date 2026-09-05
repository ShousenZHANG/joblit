"use client";

import { useTranslations } from "next-intl";
import { FileCheck2, PencilLine } from "lucide-react";

/** Optional editing is available after the one-click PDF generation. */
export function TailorLockedSteps() {
  const t = useTranslations("tailor.dialog");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
        <PencilLine className="mb-3 size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">{t("stepReviewTitle")}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("reviewAvailable")}</p>
      </section>
      <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
        <FileCheck2 className="mb-3 size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">{t("stepPublishTitle")}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("publishAvailable")}</p>
      </section>
    </div>
  );
}
