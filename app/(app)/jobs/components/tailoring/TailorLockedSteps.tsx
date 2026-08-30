"use client";

import { useTranslations } from "next-intl";
import { TailorStep } from "./TailorStep";

/**
 * Both phases before there is anything to review.
 *
 * They are listed rather than hidden so the sequence is legible from the first
 * frame: the user can see that generating leads to an editor and a PDF, not to
 * an unknown number of further screens.
 */
export function TailorLockedSteps() {
  const t = useTranslations("tailor.dialog");
  return (
    <>
      <TailorStep index={1} state="future" title={t("stepReviewTitle")} />
      <TailorStep index={2} state="future" title={t("stepPublishTitle")} />
    </>
  );
}
