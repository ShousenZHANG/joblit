"use client";

import { useTranslations } from "next-intl";
import { TailorStep } from "./TailorStep";

/**
 * Phases three and four before there is anything to review.
 *
 * They are listed rather than hidden so the sequence is legible from the first
 * frame: the user can see that pasting a result leads to an editor and a PDF,
 * not to an unknown number of further screens.
 */
export function TailorLockedSteps() {
  const t = useTranslations("tailor.dialog");
  return (
    <>
      <TailorStep index={3} state="future" title={t("stepReviewTitle")} />
      <TailorStep index={4} state="future" title={t("stepPublishTitle")} />
    </>
  );
}
