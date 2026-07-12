export default function LoadingDiscover() {
  return (
    <div className="route-loading-enter flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden cosmos-panel rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur">
        {/* Header */}
        <div className="shrink-0 space-y-2 border-b border-border/60 px-4 pb-3 pt-3 lg:px-6 lg:pt-6">
          <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted/60" />
          <div className="flex gap-2 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-7 w-20 animate-pulse rounded-full bg-muted/50" />
            ))}
          </div>
        </div>
        {/* Video grid */}
        <div className="min-h-0 flex-1 overflow-hidden p-4 lg:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="space-y-2 rounded-2xl border border-border/50 p-2"
              >
                <div className="aspect-video w-full animate-pulse rounded-xl bg-muted/60" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-muted/60" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
