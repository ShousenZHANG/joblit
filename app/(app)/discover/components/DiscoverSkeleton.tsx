import { Skeleton } from "@/components/ui/skeleton";

export function TrendingSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-white p-4">
          <div className="mb-2 flex items-center gap-2.5">
            <Skeleton className="h-6 w-6 rounded-md" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="mb-1.5 h-3.5 w-full" />
          <Skeleton className="mb-3 h-3.5 w-3/4" />
          <div className="flex gap-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function VideoSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border bg-white">
          <Skeleton className="aspect-video w-full" />
          <div className="p-3">
            <Skeleton className="mb-1.5 h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

