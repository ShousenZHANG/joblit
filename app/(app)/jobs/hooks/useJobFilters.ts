import { useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMarket } from "@/hooks/useMarket";
import type { JobStatus } from "../types";

export function useJobFilters() {
  const market = useMarket();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "ALL">("ALL");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [jobLevelFilter, setJobLevelFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const pageSize = 10;

  const filters = useMemo(
    () => ({ statusFilter, locationFilter, jobLevelFilter, market, sortOrder, pageSize }),
    [statusFilter, locationFilter, jobLevelFilter, market, sortOrder, pageSize],
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
    sp.set("sort", debouncedFilters.sortOrder);
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
    sortOrder,
    setSortOrder,
    pageSize,
    market,
    queryString,
  };
}
