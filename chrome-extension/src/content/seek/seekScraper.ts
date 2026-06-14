// Seek import button — injected on au.seek.com search pages. On click it issues
// the JobSearchV6 graphql query FROM THE USER'S OWN BROWSER (credentials:
// "include" → their session cookie, their residential IP, a real browser
// fingerprint), which is what clears Cloudflare where the server-side worker
// can't (ADR-0003). Mapped rows go to the background worker → /api/ext/jobs/import.

import { sendMessage } from "@ext/shared/messaging";
import type { SeekImportItem } from "@ext/shared/types";
import {
  JOB_SEARCH_V6_QUERY,
  SEEK_GRAPHQL_URL,
  buildSeekVariables,
  extractSeekKeywords,
  isSeekSearchUrl,
  mapSeekJob,
  parseJobSearchV6,
} from "./seekClient";

const BTN_ID = "joblit-seek-import-btn";
const MAX_PAGES = 5; // Seek caps a search at ~5 pages × 100.
const PAGE_SIZE = 100;
const IMPORT_CHUNK = 200; // matches the endpoint's per-call cap.

const IDLE_LABEL = "Import to Joblit";

function styleButton(btn: HTMLButtonElement) {
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "2147483646",
    height: "44px",
    padding: "0 18px",
    borderRadius: "9999px",
    border: "none",
    background: "#059669",
    color: "#fff",
    fontSize: "14px",
    fontWeight: "600",
    fontFamily: "system-ui, sans-serif",
    boxShadow: "0 10px 30px -10px rgba(5,150,105,0.6)",
    cursor: "pointer",
    transition: "transform 0.15s ease, background 0.15s ease",
  } satisfies Partial<CSSStyleDeclaration>);
}

function setLabel(btn: HTMLButtonElement, text: string, busy: boolean) {
  btn.textContent = text;
  btn.disabled = busy;
  btn.style.opacity = busy ? "0.75" : "1";
  btn.style.cursor = busy ? "default" : "pointer";
}

async function fetchSeekPage(keywords: string, page: number): Promise<unknown[]> {
  const res = await fetch(SEEK_GRAPHQL_URL, {
    method: "POST",
    credentials: "include", // the user's own Seek session cookie
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      operationName: "JobSearchV6",
      query: JOB_SEARCH_V6_QUERY,
      variables: buildSeekVariables(keywords, page, PAGE_SIZE),
    }),
  });
  if (!res.ok) throw new Error(`Seek responded ${res.status}`);
  return parseJobSearchV6(await res.json()).jobs;
}

async function scrapeAndImport(btn: HTMLButtonElement) {
  const keywords = extractSeekKeywords(location.href);
  setLabel(btn, "Collecting…", true);
  try {
    const seen = new Set<string>();
    const items: SeekImportItem[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const rows = await fetchSeekPage(keywords, page);
      if (rows.length === 0) break;
      for (const row of rows) {
        const item = mapSeekJob(row);
        if (item && !seen.has(item.jobUrl)) {
          seen.add(item.jobUrl);
          items.push(item);
        }
      }
      if (rows.length < PAGE_SIZE) break; // last page
    }

    if (items.length === 0) {
      setLabel(btn, "No jobs found", false);
      return;
    }

    setLabel(btn, `Importing ${items.length}…`, true);
    let imported = 0;
    for (let i = 0; i < items.length; i += IMPORT_CHUNK) {
      const chunk = items.slice(i, i + IMPORT_CHUNK);
      const resp = await sendMessage<{ imported: number; invalid: number }>({
        type: "IMPORT_SEEK_JOBS",
        data: { items: chunk },
      });
      if (!resp.success) throw new Error(resp.error || "Import failed");
      imported += resp.data?.imported ?? 0;
    }
    setLabel(btn, `Imported ${imported} ✓`, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed";
    // A 403 here would be surprising (this is the user's real browser) but
    // surface it honestly rather than silently doing nothing.
    setLabel(btn, /403|challenge/i.test(msg) ? "Seek blocked — refresh & retry" : "Import failed", false);
  } finally {
    setTimeout(() => setLabel(btn, IDLE_LABEL, false), 4000);
  }
}

function mountButton() {
  if (document.getElementById(BTN_ID)) return;
  const btn = document.createElement("button");
  btn.id = BTN_ID;
  styleButton(btn);
  setLabel(btn, IDLE_LABEL, false);
  btn.addEventListener("click", () => {
    if (!btn.disabled) void scrapeAndImport(btn);
  });
  document.body.appendChild(btn);
}

function removeButton() {
  document.getElementById(BTN_ID)?.remove();
}

/** Show the import button on Seek search pages, tracking SPA navigation. */
export function initSeekScraper() {
  if (window !== window.top) return; // top frame only
  if (location.hostname.toLowerCase() !== "au.seek.com") return;

  const ensure = () => {
    if (isSeekSearchUrl(location.href)) mountButton();
    else removeButton();
  };
  ensure();

  // Seek is a SPA — the URL changes without a full navigation. Poll for it
  // (cheap, 1s) so the button appears/disappears as the user moves between the
  // search results and a job detail page.
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      ensure();
    }
  }, 1000);
}
