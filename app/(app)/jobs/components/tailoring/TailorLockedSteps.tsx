"use client";

import { useTranslations } from "next-intl";
import { TailorStep } from "./TailorStep";

/**
 * Steps three and four before there is anything to review.
 *
 * They are listed rather than hidden so the sequence is legible from the first
 * frame: the user can see that pasting a result leads to an editor and a PDF,
 * not to an unknown number of further screens.
 */
export function TailorLockedSteps() {
  const t = useTranslations("tailor.dialog");
  return (
    <>
      <TailorStep
        index={3}
        state="locked"
        title={t("stepReviewTitle")}
        description={t("stepReviewLocked")}
      />
      <TailorStep
        index={4}
        state="locked"
        title={t("stepPublishTitle")}
        description={t("stepPublishBody")}
      />
    </>
  );
}
