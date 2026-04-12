import { Skeleton } from "@/components/ui/skeleton";

export function TrendingSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
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

export function NewsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="mb-2 flex items-center justify-between">
            <Skeleton className="h-4 w-16 rounded-md" />
            <Skeleton className="h-3.5 w-8" />
          </div>
          <Skeleton className="mb-1.5 h-4 w-full" />
          <Skeleton className="mb-2 h-3.5 w-5/6" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
      ))}
    </div>
  );
}
