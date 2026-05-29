import type { Instrumentation } from "next";

// Next.js calls onRequestError for every uncaught error in a server component,
// route handler, or middleware — a single catch-all that funnels 100% of
// unhandled server errors into the observability seam, including the routes
// that hand-roll their own try/catch. Dynamic import keeps the seam (and any
// future heavy SDK) out of the instrumentation bootstrap.
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  const { reportError } = await import("@/lib/server/observability/errorReporter");
  reportError(err, {
    scope: "next.onRequestError",
    tags: {
      path: request.path,
      method: request.method,
      routeType: context.routeType,
      routePath: context.routePath,
    },
  });
};
