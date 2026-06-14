// Seek import button — injected on au.seek.com search pages. It does NOT replay
// the JobSearchV6 query (Seek's gateway rejects that as UNSTABLE_QUERY_ERROR).
// Instead the MAIN-world interceptor (seekInterceptMain) captures the rows the
// Seek frontend itself loads as the user browses, and posts them here; this
// button imports the captured rows to Joblit via the background worker →
// /api/ext/jobs/import. Credentials never leave the browser.

import { sendMessage } from "@ext/shared/messaging";
import type { SeekImportItem } from "@ext/shared/types";
import { isSeekSearchUrl, mapSeekJob } from "./seekClient";

const BTN_ID = "joblit-seek-import-btn";
const IMPORT_CHUNK = 200; // matches the endpoint's per-call cap.

// Rows captured from the page's own JobSearchV6 responses, deduped by URL.
// Cleared after a successful import.
const captured = new Map<string, SeekImportItem>();
let busy = false;

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
    transition: "background 0.15s ease, opacity 0.15s ease",
  } satisfies Partial<CSSStyleDeclaration>);
}

function setLabel(btn: HTMLButtonElement, text: string, isBusy: boolean) {
  btn.textContent = text;
  btn.disabled = isBusy;
  btn.style.opacity = isBusy ? "0.75" : "1";
  btn.style.cursor = isBusy ? "default" : "pointer";
}

function idleLabel(): string {
  return captured.size > 0
    ? `Import ${captured.size} to Joblit`
    : "Joblit: scroll Seek to capture";
}

function refresh() {
  const btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
  if (btn && !busy) setLabel(btn, idleLabel(), false);
}

function onPageMessage(e: MessageEvent) {
  if (e.source !== window) return;
  const d = e.data as { __joblitSeek?: boolean; jobs?: unknown[] } | null;
  if (!d || d.__joblitSeek !== true || !Array.isArray(d.jobs)) return;
  let added = 0;
  for (const raw of d.jobs) {
    const item = mapSeekJob(raw);
    if (item && !captured.has(item.jobUrl)) {
      captured.set(item.jobUrl, item);
      added += 1;
    }
  }
  if (added) refresh();
}

async function importCaptured(btn: HTMLButtonElement) {
  if (busy || captured.size === 0) return;
  busy = true;
  const items = [...captured.values()];
  setLabel(btn, `Importing ${items.length}…`, true);
  try {
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
    captured.clear();
    setLabel(btn, `Imported ${imported} ✓`, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed";
    setLabel(btn, /not authenticated|401/i.test(msg) ? "Connect Joblit first" : "Import failed", false);
  } finally {
    busy = false;
    setTimeout(refresh, 4000);
  }
}

function mountButton() {
  if (document.getElementById(BTN_ID)) return;
  const btn = document.createElement("button");
  btn.id = BTN_ID;
  styleButton(btn);
  setLabel(btn, idleLabel(), false);
  btn.addEventListener("click", () => void importCaptured(btn));
  document.body.appendChild(btn);
}

function removeButton() {
  document.getElementById(BTN_ID)?.remove();
}

/** Listen for captured rows and show the import button on Seek search pages. */
export function initSeekScraper() {
  if (window !== window.top) return; // top frame only
  if (location.hostname.toLowerCase() !== "au.seek.com") return;

  // Rows arrive from the MAIN-world interceptor (seekInterceptMain) as the user
  // browses; accumulate them even before the button mounts.
  window.addEventListener("message", onPageMessage);

  const ensure = () => {
    if (isSeekSearchUrl(location.href)) mountButton();
    else removeButton();
  };
  ensure();

  // Seek is a SPA — poll for URL changes so the button follows search <-> detail.
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      ensure();
    }
  }, 1000);
}
