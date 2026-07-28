"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TailorReviewDialogView } from "./TailorReviewDialogView";
import type {
  TailorReviewDraft,
  TailorReviewFinalized,
} from "./TailorReviewDialog.types";
import {
  useTailoringEditSession,
  type TailoringEditSession,
} from "../[id]/tailor/useTailoringEditSession";

export type {
  TailorReviewDraft,
  TailorReviewFinalized,
} from "./TailorReviewDialog.types";

type CloseRequestRef = {
  current: (() => void) | null;
};

type TailorReviewDialogProps = {
  open: boolean;
  draft: TailorReviewDraft | null;
  onOpenChange: (open: boolean) => void;
  onFinalized: (result: TailorReviewFinalized) => void;
};

export function TailorReviewDialog({
  open,
  draft,
  onOpenChange,
  onFinalized,
}: TailorReviewDialogProps): ReactElement {
  const closeRequestRef = useRef<(() => void) | null>(null);
  return (
    <Dialog
      open={open && !!draft}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else closeRequestRef.current?.();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] w-[100vw] max-w-none translate-x-0 translate-y-0 grid-rows-none flex-col gap-0 overflow-hidden rounded-none border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_44%,#edf7f2_100%)] p-0 shadow-[0_34px_110px_-44px_rgba(15,23,42,0.70),0_16px_42px_-34px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/5 dark:border-border/60 dark:bg-card dark:bg-none dark:ring-white/10 sm:left-4 sm:top-4 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none sm:rounded-[2rem]"
      >
        {draft ? (
          <TailorReviewDialogBody
            key={`${draft.applicationId}-${draft.target}`}
            draft={draft}
            onClose={() => onOpenChange(false)}
            onFinalized={onFinalized}
            closeRequestRef={closeRequestRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TailorReviewDialogBody({
  draft,
  onClose,
  onFinalized,
  closeRequestRef,
}: {
  draft: TailorReviewDraft;
  onClose: () => void;
  onFinalized: (result: TailorReviewFinalized) => void;
  closeRequestRef: CloseRequestRef;
}): ReactElement {
  const session = useTailorReviewSession(draft);
  useCloseRequestBridge(session, onClose, closeRequestRef);
  return (
    <TailorReviewDialogView
      draft={draft}
      session={session}
      onClose={() => void session.saveAndExit(onClose)}
      onFinalize={() => void finalizeReview(session, onFinalized)}
    />
  );
}

function useTailorReviewSession(
  draft: TailorReviewDraft,
): TailoringEditSession {
  const t = useTranslations("tailor");
  return useTailoringEditSession({
    applicationId: draft.applicationId,
    initialStatus: draft.initialStatus,
    initialAiContent: draft.initialAiContent,
    initialAiContentHash: draft.initialAiContentHash,
    initialResumePdfUrl: draft.resumePdfUrl,
    initialCoverPdfUrl: draft.coverPdfUrl,
    initialTarget: draft.target,
    autoPreview: true,
    messages: {
      conflict: t("save.conflict"),
      saveFailed: t("save.failedRetry"),
      previewFailed: t("dialog.errorPreview"),
      finalizeFailed: t("dialog.errorFinalize"),
      discardFailed: t("dialog.errorDiscard"),
      exitFailed: t("dialog.errorSaveStillOpen"),
    },
  });
}

function useCloseRequestBridge(
  session: TailoringEditSession,
  onClose: () => void,
  closeRequestRef: CloseRequestRef,
): void {
  useEffect(() => {
    const requestClose = () => void session.saveAndExit(onClose);
    closeRequestRef.current = requestClose;
    return () => {
      if (closeRequestRef.current === requestClose) {
        closeRequestRef.current = null;
      }
    };
  });
}

async function finalizeReview(
  session: TailoringEditSession,
  onFinalized: (result: TailorReviewFinalized) => void,
): Promise<void> {
  const result = await session.finalize();
  if (!result) return;
  onFinalized({
    target: session.document.target,
    resumePdfUrl: result.resumePdfUrl,
    resumePdfName: result.resumePdfName,
    coverPdfUrl: result.coverPdfUrl,
    coverPdfName: result.coverPdfName,
  });
}
