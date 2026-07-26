"use client";

import { useCallback, useRef } from "react";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import {
  FetchProgressDialog,
  FetchProgressFab,
} from "./fetch-progress/FetchProgressView";
import { useFetchProgressModel } from "./fetch-progress/useFetchProgressModel";
import { useFetchStatus } from "./FetchStatusContext";

function useFabFocusControl(setOpen: (open: boolean) => void) {
  const shouldFocusFabRef = useRef(false);
  const setFabRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node || !shouldFocusFabRef.current) return;
    node.focus({ preventScroll: true });
    shouldFocusFabRef.current = false;
  }, []);
  const minimize = useCallback(() => {
    shouldFocusFabRef.current = true;
    setOpen(false);
  }, [setOpen]);
  return { setFabRef, minimize };
}

export function FetchProgressPanel() {
  const state = useFetchStatus();
  const reducedMotion = useReducedMotion();
  const model = useFetchProgressModel(state);
  const { setFabRef, minimize } = useFabFocusControl(state.setOpen);
  if (!state.runId) return null;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="fetch-progress-announcement"
      >
        {model.liveAnnouncement}
      </div>
      <AnimatePresence mode="wait" initial={!reducedMotion}>
        {!state.open ? (
          <FetchProgressFab
            {...model}
            status={state.status}
            importedCount={state.importedCount}
            reducedMotion={reducedMotion}
            setFabRef={setFabRef}
            onOpen={() => state.setOpen(true)}
          />
        ) : (
          <FetchProgressDialog
            {...model}
            status={state.status}
            importedCount={state.importedCount}
            error={state.error}
            queryTitle={state.queryTitle}
            queryTerms={state.queryTerms}
            smartExpand={state.smartExpand}
            elapsedSeconds={state.elapsedSeconds}
            lanes={state.lanes}
            cancelling={state.cancelling}
            cancelError={state.cancelError}
            reducedMotion={reducedMotion}
            onMinimize={minimize}
            onCancel={state.cancelRun}
          />
        )}
      </AnimatePresence>
    </>
  );
}
