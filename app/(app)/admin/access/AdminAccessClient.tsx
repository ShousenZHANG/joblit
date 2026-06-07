"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Mail, ShieldX, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type AccessStatus = "PENDING" | "APPROVED" | "REJECTED";

interface AccessRequestRow {
  id: string;
  email: string;
  status: AccessStatus;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
}

const STATUS_STYLES: Record<AccessStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-200",
  APPROVED: "bg-brand-emerald-50 text-brand-emerald-700 ring-brand-emerald-200",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AdminAccessClient() {
  const [rows, setRows] = useState<AccessRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/access-requests", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load");
      setRows(Array.isArray(json.requests) ? json.requests : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = useCallback(async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    const nextStatus: AccessStatus = action === "approve" ? "APPROVED" : "REJECTED";
    // Optimistic: flip the row immediately; revert on failure.
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
    try {
      const res = await fetch(`/api/admin/access-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Review failed");
    } catch {
      await load(); // reconcile from server on any failure
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === "PENDING").length,
    [rows],
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 lg:px-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Access requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approve an email to add it to the sign-in allowlist. The applicant then
            signs in with the Google or GitHub account on that address.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
          {pendingCount} pending
        </span>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}{" "}
          <button onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-emerald-50 text-brand-emerald-600 ring-1 ring-brand-emerald-100">
            <Mail className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm font-semibold text-foreground">No access requests yet</p>
          <p className="text-xs text-muted-foreground">Requests from the landing page appear here.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const isBusy = busyId === r.id;
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{r.email}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${STATUS_STYLES[r.status]}`}
                    >
                      {r.status === "PENDING" && <Clock className="h-3 w-3" aria-hidden />}
                      {r.status === "APPROVED" && <Check className="h-3 w-3" aria-hidden />}
                      {r.status === "REJECTED" && <ShieldX className="h-3 w-3" aria-hidden />}
                      {r.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Applied {formatDate(r.createdAt)}
                    {r.note ? <span className="text-foreground/70"> · “{r.note}”</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.status !== "APPROVED" && (
                    <Button
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void review(r.id, "approve")}
                      className="h-9 rounded-full bg-brand-emerald-600 px-4 text-xs font-semibold text-white hover:bg-brand-emerald-700"
                    >
                      <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Approve
                    </Button>
                  )}
                  {r.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => void review(r.id, "reject")}
                      className="h-9 rounded-full px-3 text-xs font-medium text-muted-foreground hover:text-rose-600"
                    >
                      <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Reject
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
