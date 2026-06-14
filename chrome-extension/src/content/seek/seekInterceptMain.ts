// Runs in the PAGE's MAIN world at document_start (see manifest content_scripts
// world:"MAIN"). Seek's graphql gateway rejects replayed / ad-hoc queries
// (UNSTABLE_QUERY_ERROR) because they lack the signature its own client
// attaches. So we do NOT replay: we wrap window.fetch and READ the JobSearchV6
// responses the Seek frontend ITSELF fetches (initial load, pagination, filter
// changes). The page's request is never modified — we only forward the
// already-rendered rows to the isolated content script via postMessage. This is
// the user reading their own search results; no access control is circumvented.

interface JobSearchV6Response {
  data?: { jobSearchV6?: { data?: unknown[] } | null } | null;
}

(() => {
  const w = window as typeof window & { __joblitSeekHooked?: boolean };
  if (w.__joblitSeekHooked) return;
  w.__joblitSeekHooked = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const promise = origFetch(input, init);
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : "";
      if (url.includes("/graphql")) {
        void promise
          .then((res) =>
            res
              .clone()
              .json()
              .then((json: JobSearchV6Response) => {
                const rows = json?.data?.jobSearchV6?.data;
                if (Array.isArray(rows) && rows.length > 0) {
                  window.postMessage(
                    { __joblitSeek: true, jobs: rows },
                    window.location.origin,
                  );
                }
              })
              .catch(() => {}),
          )
          .catch(() => {});
      }
    } catch {
      // Never let interception break the page's own fetch.
    }
    return promise;
  };
})();
