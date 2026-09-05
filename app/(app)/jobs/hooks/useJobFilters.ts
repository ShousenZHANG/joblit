import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMarket } from "@/hooks/useMarket";
import type { JobStatus } from "../types";
import {
  parseJobsUrlState,
  writeJobsUrlState,
  type JobsUrlState,
} from "../utils/jobsUrlState";

// Sort is hardcoded to newest. The user-facing ordering toggle was removed,
// matching the default triage flow used by mainstream job boards.
const SORT_ORDER = "newest" as const;

function getFilterStateKey(
  state: Pick<JobsUrlState, "q" | "statusFilter">,
) {
  return JSON.stringify([state.q, state.statusFilter]);
}

export function useJobFilters() {
  const market = useMarket();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const urlState = useMemo(
    () => parseJobsUrlState(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  );
  // Writes may occur before Next publishes the prior replace through
  // useSearchParams. Keep a synchronous snapshot so rapid filter/selection
  // changes merge instead of dropping one another.
  const latestParamsRef = useRef(searchParamsString);
  const lastObservedFilterKeyRef = useRef(getFilterStateKey(urlState));
  const urlSyncTargetRef = useRef<string | null>(null);

  const [q, setQState] = useState(() => urlState.q);
  // Status is a primary view rather than an optional filter. The workspace
  // opens on NEW, its triage inbox.
  const [statusFilter, setStatusFilterState] = useState<JobStatus>(
    () => urlState.statusFilter,
  );
  const pageSize = 10;

  const wrapUserSetter = useCallback(
    <T,>(setter: Dispatch<SetStateAction<T>>): Dispatch<SetStateAction<T>> =>
      (value) => {
        urlSyncTargetRef.current = null;
        setter(value);
      },
    [],
  );
  const setQ = useMemo(() => wrapUserSetter(setQState), [wrapUserSetter]);
  const setStatusFilter = useMemo(
    () => wrapUserSetter(setStatusFilterState),
    [wrapUserSetter],
  );

  useEffect(() => {
    latestParamsRef.current = searchParamsString;
    const nextFilterKey = getFilterStateKey(urlState);
    if (nextFilterKey === lastObservedFilterKeyRef.current) return;

    lastObservedFilterKeyRef.current = nextFilterKey;
    urlSyncTargetRef.current = nextFilterKey;
    setQState(urlState.q);
    setStatusFilterState(urlState.statusFilter);
  }, [searchParamsString, urlState]);

  const replaceUrlState = useCallback(
    (patch: Partial<JobsUrlState>): JobsUrlState | null => {
      const currentParams = new URLSearchParams(latestParamsRef.current);
      const nextParams = writeJobsUrlState(currentParams, patch);
      const nextSearch = nextParams.toString();

      if (nextSearch === latestParamsRef.current) return null;

      latestParamsRef.current = nextSearch;
      router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, {
        scroll: false,
      });
      return parseJobsUrlState(nextParams);
    },
    [pathname, router],
  );

  // Selected row and mobile pane are workspace-only state, so they are the ONLY
  // writes exposed to callers — and they never navigate. Going through
  // router.replace requests a fresh RSC payload from the force-dynamic `/jobs`
  // route, which re-seeds the first page of results over the infinite query and
  // discards every page the user scrolled in. `replaceUrlState` stays internal
  // to the debounced filter sync below, where a re-query is the whole point.
  const replaceUrlStateShallow = useCallback(
    (patch: Partial<JobsUrlState>): JobsUrlState | null => {
      const currentParams = new URLSearchParams(latestParamsRef.current);
      const nextParams = writeJobsUrlState(currentParams, patch);
      const nextSearch = nextParams.toString();

      if (nextSearch === latestParamsRef.current) return null;

      latestParamsRef.current = nextSearch;
      if (typeof window !== "undefined") {
        const nextUrl = nextSearch ? `${pathname}?${nextSearch}` : pathname;
        // Keep Next's internal history payload intact for back/forward.
        window.history.replaceState(window.history.state, "", nextUrl);
      }
      return parseJobsUrlState(nextParams);
    },
    [pathname],
  );

  const filters = useMemo(
    () => ({ statusFilter, market, pageSize }),
    [statusFilter, market, pageSize],
  );
  const debouncedSelectFilters = useDebouncedValue(filters, 120);
  const debouncedQ = useDebouncedValue(q, 250);

  const debouncedFilters = useMemo(
    () => ({
      q: debouncedQ,
      ...debouncedSelectFilters,
    }),
    [debouncedQ, debouncedSelectFilters],
  );

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("limit", String(debouncedFilters.pageSize));
    sp.set("status", debouncedFilters.statusFilter);
    if (debouncedFilters.q.trim()) sp.set("q", debouncedFilters.q.trim());
    sp.set("market", debouncedFilters.market);
    sp.set("sort", SORT_ORDER);
    return sp.toString();
  }, [debouncedFilters]);

  useEffect(() => {
    const nextFilterState = {
      q: debouncedFilters.q.trim(),
      statusFilter: debouncedFilters.statusFilter,
    };
    const nextFilterKey = getFilterStateKey(nextFilterState);
    const urlSyncTarget = urlSyncTargetRef.current;
    if (urlSyncTarget !== null && urlSyncTarget !== nextFilterKey) return;

    urlSyncTargetRef.current = null;
    replaceUrlState(nextFilterState);
  }, [debouncedFilters, replaceUrlState]);

  return {
    q,
    debouncedQ,
    setQ,
    statusFilter,
    setStatusFilter,
    pageSize,
    market,
    queryString,
    urlState,
    replaceUrlStateShallow,
  };
}
