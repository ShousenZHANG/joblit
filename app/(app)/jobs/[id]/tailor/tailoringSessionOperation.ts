"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

export type SessionOperation = "finalizing" | "discarding" | "exiting";

export interface SessionBusyState {
  refreshing: boolean;
  finalizing: boolean;
  discarding: boolean;
  exiting: boolean;
}

interface OperationState {
  active: SessionOperation | null;
  busy: Omit<SessionBusyState, "refreshing">;
}

type OperationAction =
  | { type: "begin"; operation: SessionOperation }
  | { type: "end"; operation: SessionOperation };

const INITIAL_STATE: OperationState = {
  active: null,
  busy: {
    finalizing: false,
    discarding: false,
    exiting: false,
  },
};

export interface TailoringOperationState {
  busy: OperationState["busy"];
  begin: (operation: SessionOperation) => boolean;
  end: (operation: SessionOperation) => void;
  isActive: () => boolean;
}

export function useTailoringOperationState(): TailoringOperationState {
  const [state, dispatch] = useReducer(operationReducer, INITIAL_STATE);
  const runtimeRef = useRef({
    active: null as SessionOperation | null,
    mounted: true,
  });

  useEffect(() => {
    const runtime = runtimeRef.current;
    runtime.mounted = true;
    return () => {
      runtime.mounted = false;
      runtime.active = null;
    };
  }, []);

  const begin = useCallback((operation: SessionOperation) => {
    const runtime = runtimeRef.current;
    if (!runtime.mounted || runtime.active) return false;
    runtime.active = operation;
    dispatch({ type: "begin", operation });
    return true;
  }, []);

  const end = useCallback((operation: SessionOperation) => {
    const runtime = runtimeRef.current;
    if (runtime.active !== operation) return;
    runtime.active = null;
    if (runtime.mounted) dispatch({ type: "end", operation });
  }, []);

  const isActive = useCallback(() => runtimeRef.current.active !== null, []);
  return { busy: state.busy, begin, end, isActive };
}

function operationReducer(
  state: OperationState,
  action: OperationAction,
): OperationState {
  if (action.type === "begin") {
    return {
      active: action.operation,
      busy: { ...state.busy, [action.operation]: true },
    };
  }
  if (state.active !== action.operation) return state;
  return {
    active: null,
    busy: { ...state.busy, [action.operation]: false },
  };
}
