import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  /** Optional trailing controls (right-aligned on the same row as the title). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared page heading — single source for the app's H1 type scale so titles
 * stop drifting (`text-lg lg:text-2xl` was repeated ad-hoc with/without
 * tracking). Big-tech headings are tight-tracked; this enforces it.
 */
export function PageHeading({
  title,
  description,
  actions,
  className,
}: PageHeadingProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground lg:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 hidden text-sm leading-relaxed text-muted-foreground sm:block">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
