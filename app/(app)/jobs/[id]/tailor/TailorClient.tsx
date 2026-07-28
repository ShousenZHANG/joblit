"use client";

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { TailorClientView, type TailorJob } from "./TailorClientView";
import {
  useTailoringEditSession,
  type TailoringEditSession,
} from "./useTailoringEditSession";

interface TailorClientProps {
  applicationId: string;
  initialStatus: "DRAFT" | "FINAL";
  initialAiContent: AiContent;
  initialAiContentHash: string | null;
  resumePdfUrl: string | null;
  coverPdfUrl: string | null;
  resumePdfName: string;
  coverPdfName: string;
  job: TailorJob;
}

export function TailorClient(props: TailorClientProps): ReactElement {
  const t = useTranslations("tailor");
  const session = useTailoringEditSession({
    applicationId: props.applicationId,
    initialStatus: props.initialStatus,
    initialAiContent: props.initialAiContent,
    initialAiContentHash: props.initialAiContentHash,
    initialResumePdfUrl: props.resumePdfUrl,
    initialCoverPdfUrl: props.coverPdfUrl,
    messages: {
      conflict: t("save.conflict"),
      saveFailed: t("save.failedRetry"),
      previewFailed: t("refreshFailed"),
      finalizeFailed: t("finalizeFailed"),
      discardFailed: t("discardFailed"),
      exitFailed: t("save.failedRetry"),
    },
  });
  const actions = useTailorNavigationActions(session);

  return (
    <TailorClientView
      session={session}
      resumePdfName={props.resumePdfName}
      coverPdfName={props.coverPdfName}
      job={props.job}
      onBack={actions.back}
      onFinalize={actions.finalize}
    />
  );
}

function useTailorNavigationActions(session: TailoringEditSession): {
  back: () => void;
  finalize: () => void;
} {
  const router = useRouter();
  return {
    back: () => {
      void session.saveAndExit(() => router.push("/jobs"));
    },
    finalize: () => {
      void session.finalize().then((result) => {
        if (result) router.push("/jobs");
      });
    },
  };
}
