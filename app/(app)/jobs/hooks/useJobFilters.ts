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
  state: Pick<
    JobsUrlState,
    "q" | "statusFilter" | "locationFilter" | "jobLevelFilter"
  >,
) {
  return JSON.stringify([
    state.q,
    state.statusFilter,
    state.locationFilter,
    state.jobLevelFilter,
  ]);
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
  const [locationFilter, setLocationFilterState] = useState(
    () => urlState.locationFilter,
  );
  const [jobLevelFilter, setJobLevelFilterState] = useState(
    () => urlState.jobLevelFilter,
  );
  // Fit sort is a session-local view toggle (not persisted to the URL): jobs
  // ordered by AI match score, unscored last, served entirely by the API.
  const [sortByFit, setSortByFit] = useState(false);
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
  const setLocationFilter = useMemo(
    () => wrapUserSetter(setLocationFilterState),
    [wrapUserSetter],
  );
  const setJobLevelFilter = useMemo(
    () => wrapUserSetter(setJobLevelFilterState),
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
    setLocationFilterState(urlState.locationFilter);
    setJobLevelFilterState(urlState.jobLevelFilter);
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

  // Selected row and mobile pane are workspace-only state. Using
  // router.replace here would navigate the force-dynamic `/jobs` route and
  // request a fresh RSC payload, which can remount the nested list viewport.
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
    () => ({ statusFilter, locationFilter, jobLevelFilter, market, pageSize }),
    [statusFilter, locationFilter, jobLevelFilter, market, pageSize],
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
    if (debouncedFilters.locationFilter !== "ALL") {
      sp.set("location", debouncedFilters.locationFilter);
    }
    if (debouncedFilters.jobLevelFilter !== "ALL") {
      sp.set("jobLevel", debouncedFilters.jobLevelFilter);
    }
    sp.set("market", debouncedFilters.market);
    sp.set("sort", sortByFit ? "fit" : SORT_ORDER);
    return sp.toString();
  }, [debouncedFilters, sortByFit]);

  useEffect(() => {
    const nextFilterState = {
      q: debouncedFilters.q.trim(),
      statusFilter: debouncedFilters.statusFilter,
      locationFilter: debouncedFilters.locationFilter,
      jobLevelFilter: debouncedFilters.jobLevelFilter,
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
    locationFilter,
    setLocationFilter,
    jobLevelFilter,
    setJobLevelFilter,
    pageSize,
    market,
    sortByFit,
    setSortByFit,
    queryString,
    urlState,
    replaceUrlState,
    replaceUrlStateShallow,
  };
}
