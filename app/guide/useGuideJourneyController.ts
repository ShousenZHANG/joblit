"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { fetchJson } from "@/lib/api/fetchJson";
import {
  type OnboardingChecklist,
  type OnboardingTaskId,
} from "@/lib/onboarding";
import {
  completeGuideTask,
  currentGuideTask,
  reconcileGuideState,
  type GuideJourneyState,
  type GuideTaskCompletion,
} from "./guideJourney";

type GuidePatch =
  | {
      type: "complete_task";
      taskId: OnboardingTaskId;
      checklist?: OnboardingChecklist;
    }
  | { type: "reopen" }
  | { type: "skip" };

type GuideJourneyControllerOptions = {
  userId: string | null;
  enabled: boolean;
  onNewUser: () => void;
};

type ScopedJourneyState = {
  userId: string | null;
  state: GuideJourneyState | null;
};

type JourneyStateStore = {
  currentRef: MutableRefObject<GuideJourneyState | null>;
  userScopeRef: MutableRefObject<string | null>;
  commit: (state: GuideJourneyState | null) => void;
  reconcile: (
    state: GuideJourneyState,
    preserveCompleted: boolean,
  ) => GuideJourneyState;
};

type JourneyStateModel = {
  state: GuideJourneyState | null;
  store: JourneyStateStore;
};

type JourneyLoadOptions = GuideJourneyControllerOptions & {
  signal: AbortSignal;
  store: JourneyStateStore;
  setLoading: Dispatch<SetStateAction<boolean>>;
};

type GuideJourneyController = {
  loading: boolean;
  state: GuideJourneyState | null;
  activeTaskId: OnboardingTaskId | null;
  complete: (taskId: OnboardingTaskId) => GuideTaskCompletion;
  reopen: () => void;
  dismiss: () => void;
};

function isBrandNewJourney(state: GuideJourneyState): boolean {
  return (
    state.stage === "NEW_USER" &&
    !state.dismissed &&
    !state.completedAt &&
    !state.isComplete
  );
}

function useJourneyStateStore(userId: string | null): JourneyStateModel {
  const [snapshot, setSnapshot] = useState<ScopedJourneyState>({
    userId,
    state: null,
  });
  const currentRef = useRef<GuideJourneyState | null>(null);
  const userScopeRef = useRef(userId);
  const commit = useCallback((state: GuideJourneyState | null) => {
    currentRef.current = state;
    setSnapshot({ userId: userScopeRef.current, state });
  }, []);
  useEffect(() => {
    if (userScopeRef.current === userId) return;
    userScopeRef.current = userId;
    commit(null);
  }, [commit, userId]);
  const reconcile = useCallback(
    (state: GuideJourneyState, preserveCompleted: boolean) => {
      const resolved = reconcileGuideState(
        currentRef.current,
        state,
        preserveCompleted,
      );
      commit(resolved);
      return resolved;
    },
    [commit],
  );
  const store = useMemo(
    () => ({ currentRef, userScopeRef, commit, reconcile }),
    [commit, reconcile],
  );
  return {
    state: snapshot.userId === userId ? snapshot.state : null,
    store,
  };
}

function useGuidePatch(
  userId: string | null,
  store: JourneyStateStore,
): (payload: GuidePatch) => Promise<void> {
  return useCallback(
    async (payload: GuidePatch) => {
      if (!userId) return;
      const requestUserId = userId;
      try {
        const json = (await fetchJson("/api/onboarding/state", {
          method: "PATCH",
          body: JSON.stringify(payload),
          fallbackError: "Failed to update onboarding state",
        })) as { state: GuideJourneyState };
        if (store.userScopeRef.current !== requestUserId) return;
        store.reconcile(json.state, true);
      } catch {
        // Optimistic state remains authoritative while persistence recovers.
      }
    },
    [store, userId],
  );
}

async function loadGuideJourney({
  userId,
  enabled,
  onNewUser,
  signal,
  store,
  setLoading,
}: JourneyLoadOptions): Promise<void> {
  if (!enabled || !userId) {
    if (!signal.aborted) {
      store.commit(null);
      setLoading(false);
    }
    return;
  }
  setLoading(true);
  try {
    const json = (await fetchJson("/api/onboarding/state", {
      cache: "no-store",
      signal,
      fallbackError: "Failed to load onboarding state",
    })) as { state: GuideJourneyState };
    if (signal.aborted || store.userScopeRef.current !== userId) return;
    const resolved = store.reconcile(json.state, true);
    if (isBrandNewJourney(resolved)) onNewUser();
  } catch {
    if (!signal.aborted && store.userScopeRef.current === userId) {
      store.commit(null);
    }
  } finally {
    if (!signal.aborted && store.userScopeRef.current === userId) {
      setLoading(false);
    }
  }
}

function useGuideLoader(options: GuideJourneyControllerOptions & {
  store: JourneyStateStore;
  setLoading: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadGuideJourney({ ...options, signal: controller.signal });
      }
    });
    return () => controller.abort();
  }, [options]);
}

function useJourneyActions(
  store: JourneyStateStore,
  patch: (payload: GuidePatch) => Promise<void>,
) {
  const complete = useCallback(
    (taskId: OnboardingTaskId) => {
      const result = completeGuideTask(store.currentRef.current, taskId);
      if (result.changed) store.commit(result.state);
      void patch(
        result.checklist
          ? { type: "complete_task", taskId, checklist: result.checklist }
          : { type: "complete_task", taskId },
      );
      return result;
    },
    [patch, store],
  );
  const reopen = useCallback(() => void patch({ type: "reopen" }), [patch]);
  const dismiss = useCallback(() => void patch({ type: "skip" }), [patch]);
  return useMemo(
    () => ({ complete, reopen, dismiss }),
    [complete, dismiss, reopen],
  );
}

export function useGuideJourneyController({
  userId,
  enabled,
  onNewUser,
}: GuideJourneyControllerOptions): GuideJourneyController {
  const [loading, setLoading] = useState(false);
  const stateModel = useJourneyStateStore(userId);
  const { store } = stateModel;
  const patch = useGuidePatch(userId, store);
  const loaderOptions = useMemo(
    () => ({ userId, enabled, onNewUser, store, setLoading }),
    [enabled, onNewUser, store, userId],
  );
  useGuideLoader(loaderOptions);
  const actions = useJourneyActions(store, patch);
  const state = enabled ? stateModel.state : null;
  return useMemo(
    () => ({
      loading: enabled ? loading : false,
      state,
      activeTaskId: currentGuideTask(state)?.id ?? null,
      ...actions,
    }),
    [actions, enabled, loading, state],
  );
}
