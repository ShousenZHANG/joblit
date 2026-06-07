"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "next-auth/react";

export type FetchRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type FetchSource = "jobspy" | "seek";

// One tracked run (a single source). A fetch action starts one of these per
// selected source — picking "Both" tracks two lanes (jobspy + seek) at once.
export type FetchRunLane = {
  id: string;
  source: FetchSource;
  status: FetchRunStatus;
  importedCount: number;
  error: string | null;
  queryTitle: string | null;
  queryTerms: string[];
  smartExpand: boolean;
};

type RunMeta = { id: string; source: FetchSource };

type FetchRunSnapshot = {
  status: FetchRunStatus;
  importedCount: number;
  error: string | null;
  queryTitle?: string | null;
  queryTerms?: string[];
  smartExpand?: boolean;
  updatedAt?: string | null;
};

type FetchStatusContextValue = {
  // Aggregate surface (back-compat: consumers like JobsClient read these).
  runId: string | null;
  status: FetchRunStatus | null;
  importedCount: number;
  error: string | null;
  queryTitle: string | null;
  queryTerms: string[];
  smartExpand: boolean;
  elapsedSeconds: number;
  // Per-source lanes for the progress panel.
  lanes: FetchRunLane[];
  open: boolean;
  setOpen: (open: boolean) => void;
  startRuns: (runs: RunMeta[]) => void;
  cancelRun: () => Promise<void>;
};

const FetchStatusContext = createContext<FetchStatusContextValue | null>(null);

const RUNS_KEY = "joblit_fetch_runs";
const STARTED_AT_KEY = "joblit_fetch_started_at";
const PANEL_OPEN_KEY = "joblit_fetch_panel_open";
const ENDED_AT_KEY = "joblit_fetch_ended_at";
// Stable empty array so the aggregate `queryTerms` keeps a constant reference
// when no lane has terms — avoids churning the context value's useMemo deps.
const EMPTY_TERMS: string[] = [];

const isTerminal = (s: FetchRunStatus) => s === "SUCCEEDED" || s === "FAILED";

/** Aggregate many lane statuses into one: any active → running/queued; else a
 *  partial success counts as success; only all-failed reads as failed. */
function aggregateStatus(lanes: FetchRunLane[]): FetchRunStatus | null {
  if (!lanes.length) return null;
  if (lanes.some((l) => l.status === "RUNNING")) return "RUNNING";
  if (lanes.some((l) => l.status === "QUEUED")) return "QUEUED";
  if (lanes.some((l) => l.status === "SUCCEEDED")) return "SUCCEEDED";
  return "FAILED";
}

function parseRunMetas(raw: string | null): RunMeta[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RunMeta =>
          r &&
          typeof r.id === "string" &&
          (r.source === "jobspy" || r.source === "seek"),
      )
      .slice(0, 4);
  } catch {
    return [];
  }
}

function laneFromMeta(meta: RunMeta): FetchRunLane {
  return {
    id: meta.id,
    source: meta.source,
    status: "QUEUED",
    importedCount: 0,
    error: null,
    queryTitle: null,
    queryTerms: [],
    smartExpand: true,
  };
}

export function FetchStatusProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const [lanes, setLanes] = useState<FetchRunLane[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [open, setOpenState] = useState(false);
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storageKeys = useMemo(() => {
    const suffix = userId ?? "anonymous";
    return {
      runs: `${RUNS_KEY}:${suffix}`,
      startedAt: `${STARTED_AT_KEY}:${suffix}`,
      panelOpen: `${PANEL_OPEN_KEY}:${suffix}`,
      endedAt: `${ENDED_AT_KEY}:${suffix}`,
    };
  }, [userId]);

  const prevKeysRef = useRef<typeof storageKeys | null>(null);

  const resetState = useCallback(() => {
    setLanes([]);
    setElapsedSeconds(0);
    setOpenState(false);
  }, []);

  const refreshFromStorage = useCallback(() => {
    const metas = parseRunMetas(localStorage.getItem(storageKeys.runs));
    if (metas.length) {
      // Preserve already-polled lane state across refreshes; seed new ids.
      setLanes((prev) => {
        const byId = new Map(prev.map((l) => [l.id, l]));
        return metas.map((m) => byId.get(m.id) ?? laneFromMeta(m));
      });
      const storedOpen = localStorage.getItem(storageKeys.panelOpen);
      setOpenState(storedOpen === "0" ? false : true);
    } else {
      setLanes((prev) => (prev.length ? [] : prev));
    }
    const started = localStorage.getItem(storageKeys.startedAt);
    if (started) {
      const ms = Number(started);
      if (!Number.isNaN(ms)) {
        const endedRaw = localStorage.getItem(storageKeys.endedAt);
        const endMs = endedRaw ? Number(endedRaw) : null;
        const effectiveEnd = endMs && !Number.isNaN(endMs) ? endMs : Date.now();
        setElapsedSeconds(Math.max(0, Math.floor((effectiveEnd - ms) / 1000)));
      }
    }
  }, [storageKeys.runs, storageKeys.startedAt, storageKeys.panelOpen, storageKeys.endedAt]);

  // Rehydrate run state from localStorage on mount + whenever the user (and
  // thus the storage key) changes. This is the rule's documented valid case —
  // syncing React state FROM an external store — but the static analyzer can't
  // tell it apart from a cascading-render bug, so the rule is disabled at these
  // two call sites only. Doing this in an effect (not a lazy initialiser) keeps
  // SSR and the first client render identical, avoiding a hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage rehydration
    refreshFromStorage();
  }, [refreshFromStorage]);

  useEffect(() => {
    const prev = prevKeysRef.current;
    if (prev && prev.runs !== storageKeys.runs) {
      localStorage.removeItem(prev.runs);
      localStorage.removeItem(prev.startedAt);
      localStorage.removeItem(prev.panelOpen);
      localStorage.removeItem(prev.endedAt);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on user switch
      resetState();
    }
    prevKeysRef.current = storageKeys;
    refreshFromStorage();
  }, [storageKeys, resetState, refreshFromStorage]);

  useEffect(() => {
    function handleStart() {
      refreshFromStorage();
    }
    window.addEventListener("joblit-fetch-started", handleStart);
    window.addEventListener("storage", handleStart);
    function handleVisibility() {
      if (document.visibilityState === "visible") handleStart();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("joblit-fetch-started", handleStart);
      window.removeEventListener("storage", handleStart);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshFromStorage]);

  const fetchRun = useCallback(async (id: string): Promise<FetchRunSnapshot> => {
    const res = await fetch(`/api/fetch-runs/${id}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Failed to fetch run");
    return json.run as FetchRunSnapshot;
  }, []);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      localStorage.setItem(storageKeys.panelOpen, next ? "1" : "0");
    },
    [storageKeys.panelOpen],
  );

  const startRuns = useCallback(
    (runs: RunMeta[]) => {
      const metas = runs.slice(0, 4);
      setLanes(metas.map(laneFromMeta));
      setElapsedSeconds(0);
      setOpen(true);
      localStorage.setItem(storageKeys.runs, JSON.stringify(metas));
      localStorage.setItem(storageKeys.startedAt, String(Date.now()));
      localStorage.setItem(storageKeys.panelOpen, "1");
      localStorage.removeItem(storageKeys.endedAt);
      window.dispatchEvent(new Event("joblit-fetch-started"));
    },
    [setOpen, storageKeys],
  );

  const cancelRun = useCallback(async () => {
    const active = lanes.filter((l) => !isTerminal(l.status));
    if (!active.length) return;
    await Promise.allSettled(
      active.map((l) => fetch(`/api/fetch-runs/${l.id}/cancel`, { method: "POST" })),
    );
    setLanes((prev) =>
      prev.map((l) =>
        isTerminal(l.status)
          ? l
          : { ...l, status: "FAILED", error: "Cancelled by user" },
      ),
    );
  }, [lanes]);

  // Poll every non-terminal lane on a shared backoff until all settle.
  const laneIdsKey = lanes.map((l) => l.id).join(",");
  useEffect(() => {
    if (!laneIdsKey) return;
    const ids = laneIdsKey.split(",").filter(Boolean);
    let alive = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const pollingStartedAt = Date.now();

    const nextDelayMs = () => {
      const elapsed = Date.now() - pollingStartedAt;
      if (elapsed < 30_000) return 3_000;
      if (elapsed < 120_000) return 8_000;
      return 15_000;
    };

    const poll = async () => {
      const results = await Promise.allSettled(
        ids.map(async (id) => ({ id, snap: await fetchRun(id) })),
      );
      if (!alive) return;

      let allTerminal = true;
      setLanes((prev) =>
        prev.map((lane) => {
          const r = results.find(
            (x) => x.status === "fulfilled" && x.value.id === lane.id,
          );
          if (!r || r.status !== "fulfilled") {
            if (!isTerminal(lane.status)) allTerminal = false;
            return lane;
          }
          const s = r.value.snap;
          if (!isTerminal(s.status)) allTerminal = false;
          return {
            ...lane,
            status: s.status,
            importedCount: s.importedCount ?? 0,
            error: s.error ?? null,
            queryTitle: s.queryTitle ?? null,
            queryTerms: Array.isArray(s.queryTerms) ? s.queryTerms : [],
            smartExpand: s.smartExpand ?? true,
          };
        }),
      );

      if (allTerminal) {
        localStorage.setItem(storageKeys.endedAt, String(Date.now()));
        const startedRaw = localStorage.getItem(storageKeys.startedAt);
        const startedMs = startedRaw ? Number(startedRaw) : null;
        if (startedMs && !Number.isNaN(startedMs)) {
          setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
        }
        if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
        autoCloseTimer.current = setTimeout(() => setOpen(false), 3500);
        return; // stop polling
      }
      if (alive) pollTimer = setTimeout(() => void poll(), nextDelayMs());
    };

    pollTimer = setTimeout(() => void poll(), 0);
    return () => {
      alive = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    };
  }, [fetchRun, laneIdsKey, setOpen, storageKeys.endedAt, storageKeys.startedAt]);

  const status = useMemo(() => aggregateStatus(lanes), [lanes]);

  // Live elapsed ticker while any lane is active.
  useEffect(() => {
    if (!open) return;
    if (status !== "RUNNING" && status !== "QUEUED") return;
    const tick = () => {
      const startedRaw = localStorage.getItem(storageKeys.startedAt);
      const startedMs = startedRaw ? Number(startedRaw) : null;
      if (!startedMs || Number.isNaN(startedMs)) return;
      const endedRaw = localStorage.getItem(storageKeys.endedAt);
      const endedMs = endedRaw ? Number(endedRaw) : null;
      const effectiveEnd = endedMs && !Number.isNaN(endedMs) ? endedMs : Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((effectiveEnd - startedMs) / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [status, open, storageKeys.endedAt, storageKeys.startedAt]);

  const importedCount = useMemo(
    () => lanes.reduce((sum, l) => sum + (l.importedCount || 0), 0),
    [lanes],
  );
  const primary = lanes[0] ?? null;
  const error = useMemo(() => lanes.find((l) => l.error)?.error ?? null, [lanes]);
  const queryTerms = primary?.queryTerms ?? EMPTY_TERMS;
  const queryTitle = primary?.queryTitle ?? null;
  const smartExpand = primary?.smartExpand ?? true;

  const value = useMemo(
    () => ({
      runId: primary?.id ?? null,
      status,
      importedCount,
      error,
      queryTitle,
      queryTerms,
      smartExpand,
      elapsedSeconds,
      lanes,
      open,
      setOpen,
      startRuns,
      cancelRun,
    }),
    [
      primary?.id,
      status,
      importedCount,
      error,
      queryTitle,
      queryTerms,
      smartExpand,
      elapsedSeconds,
      lanes,
      open,
      setOpen,
      startRuns,
      cancelRun,
    ],
  );

  return <FetchStatusContext.Provider value={value}>{children}</FetchStatusContext.Provider>;
}

export function useFetchStatus() {
  const ctx = useContext(FetchStatusContext);
  if (!ctx) {
    throw new Error("useFetchStatus must be used within FetchStatusProvider");
  }
  return ctx;
}
