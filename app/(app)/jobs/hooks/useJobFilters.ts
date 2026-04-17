import { useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMarket } from "@/hooks/useMarket";
import type { JobStatus } from "../types";

// Sort is hardcoded to "newest". The user-facing "Posted: newest/oldest"
// toggle was removed — data is always sorted newest-first, matching the
// big-tech job-board default (Indeed, LinkedIn, Greenhouse).
const SORT_ORDER = "newest" as const;

export function useJobFilters() {
  const market = useMarket();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "ALL">("ALL");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [jobLevelFilter, setJobLevelFilter] = useState("ALL");
  const pageSize = 10;

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
    if (debouncedFilters.statusFilter !== "ALL") sp.set("status", debouncedFilters.statusFilter);
    if (debouncedFilters.q.trim()) sp.set("q", debouncedFilters.q.trim());
    if (debouncedFilters.locationFilter !== "ALL") sp.set("location", debouncedFilters.locationFilter);
    if (debouncedFilters.jobLevelFilter !== "ALL") sp.set("jobLevel", debouncedFilters.jobLevelFilter);
    sp.set("market", debouncedFilters.market);
    sp.set("sort", SORT_ORDER);
    return sp.toString();
  }, [debouncedFilters]);

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
    queryString,
  };
}
