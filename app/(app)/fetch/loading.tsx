export default function LoadingFetch() {
  return (
    <div className="route-loading-enter space-y-4 px-4 py-4 lg:px-6">
      {/* Page heading */}
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted/60" />
      </div>

      {/* Job title (full-width primary input) */}
      <div className="space-y-1.5">
        <div className="h-3 w-20 animate-pulse rounded bg-muted/50" />
        <div className="h-11 animate-pulse rounded-xl bg-muted/60" />
      </div>

      {/* Location + hours row */}
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-16 animate-pulse rounded bg-muted/50" />
            <div className="h-10 animate-pulse rounded-xl bg-muted/50" />
          </div>
        ))}
      </div>

      {/* Chip toggles */}
      <div className="flex gap-2">
        <div className="h-8 w-32 animate-pulse rounded-full bg-muted/50" />
        <div className="h-8 w-32 animate-pulse rounded-full bg-muted/50" />
      </div>

      {/* Exclusion dropdowns panel */}
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
              <div className="h-11 animate-pulse rounded-2xl bg-muted/50" />
            </div>
          ))}
        </div>
      </div>

      {/* Start fetch button */}
      <div className="h-10 w-32 animate-pulse rounded-xl bg-muted/70" />
    </div>
  );
}
