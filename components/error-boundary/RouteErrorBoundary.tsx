"use client";

import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CHUNK_RELOAD_STORAGE_KEY,
  isChunkLoadError,
} from "@/lib/shared/chunkLoadError";

type RouteErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

function readReloadAttempted() {
  try {
    return window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markReloadAttempted() {
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, "1");
  } catch {
    // Storage can be blocked; the manual reload button still works.
  }
}

function clearReloadAttempted() {
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
  } catch {
    // Storage can be blocked; reset should not fail because of it.
  }
}

export function RouteErrorBoundary({ error, reset }: RouteErrorBoundaryProps) {
  const t = useTranslations("errors");
  const isChunkError = useMemo(() => isChunkLoadError(error), [error]);

  useEffect(() => {
    // Dev: full error to console for debugging. Prod: log only the
    // message + digest so raw stack traces / sensitive context don't
    // surface in end-user DevTools. (A future hook can forward digest
    // to the server-side errorReporter for aggregation.)
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    } else {
      console.error(
        `[route-error] ${error.name}: ${error.message}`,
        error.digest ? `(digest ${error.digest})` : "",
      );
    }
  }, [error]);

  useEffect(() => {
    if (!isChunkError || readReloadAttempted()) return;
    markReloadAttempted();
    window.location.reload();
  }, [isChunkError]);

  const title = isChunkError
    ? t("route.updateTitle")
    : t("route.errorTitle");
  const message = isChunkError
    ? t("route.updateMessage")
    : t("route.errorMessage");

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background/90 p-6 shadow-sm backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2">
          <AlertCircle className="size-5 text-brand-emerald-600" aria-hidden />
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        </div>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              clearReloadAttempted();
              if (isChunkError) {
                window.location.reload();
                return;
              }
              reset();
            }}
            className="rounded-full bg-brand-emerald-600 px-4 text-white hover:bg-brand-emerald-700"
          >
            <RefreshCcw className="size-4" aria-hidden />
            {isChunkError ? t("route.reload") : t("route.tryAgain")}
          </Button>
          {!isChunkError && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
              className="rounded-full px-4"
            >
              {t("route.refreshApp")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
