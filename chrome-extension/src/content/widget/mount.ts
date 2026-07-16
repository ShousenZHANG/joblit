/**
 * Mount the floating widget inside a Shadow DOM to isolate styles
 * from the host page.
 */

import type { WidgetPosition } from "@ext/shared/types";

const WIDGET_HOST_ID = "joblit-autofill-widget";

export function mountWidget(initialPosition?: WidgetPosition): { shadowRoot: ShadowRoot; container: HTMLDivElement } | null {
  // Prevent double-mount
  if (document.getElementById(WIDGET_HOST_ID)) return null;

  const host = document.createElement("div");
  host.id = WIDGET_HOST_ID;
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
  document.body.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: "open" });

  // Inject isolated styles
  const style = document.createElement("style");
  style.textContent = getWidgetStyles();
  shadowRoot.appendChild(style);

  const container = document.createElement("div");
  container.id = "joblit-widget-root";
  shadowRoot.appendChild(container);

  if (initialPosition) {
    container.style.right = initialPosition.right;
    container.style.bottom = initialPosition.bottom;
  }

  return { shadowRoot, container };
}

export function unmountWidget(): void {
  const host = document.getElementById(WIDGET_HOST_ID);
  if (host) host.remove();
}

export function isWidgetMounted(): boolean {
  return !!document.getElementById(WIDGET_HOST_ID);
}

function getWidgetStyles(): string {
  return `
    :host {
      /* Light-mode tokens */
      --jf-bg: #ffffff;
      --jf-bg-subtle: #f9fafb;
      --jf-bg-hover: #f3f4f6;
      --jf-text: #111827;
      --jf-text-secondary: #4b5563;
      --jf-text-muted: #6b7280;
      --jf-text-placeholder: #9ca3af;
      --jf-text-disabled: #d1d5db;
      --jf-border: #e5e7eb;
      --jf-border-strong: #d1d5db;
      --jf-border-light: #f3f4f6;
      --jf-emerald-50: #ecfdf5;
      --jf-emerald-100: #d1fae5;
      --jf-emerald-500: #10b981;
      --jf-emerald-600: #059669;
      --jf-emerald-700: #047857;
      --jf-emerald-800: #065f46;
      --jf-blue-50: #eff6ff;
      --jf-blue-200: #bfdbfe;
      --jf-blue-700: #1e40af;
      --jf-amber-500: #f59e0b;
      --jf-amber-600: #d97706;
      --jf-red-500: #ef4444;
      --jf-red-600: #dc2626;
      --jf-red-bg: #fef2f2;
      --jf-red-border: #fecaca;
      --jf-shadow-card: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
      --jf-shadow-toast: 0 4px 12px rgba(0, 0, 0, 0.15);
      --jf-header-gradient: linear-gradient(135deg, #10b981, #047857);
      --jf-collapsed-gradient: linear-gradient(135deg, #10b981, #047857);
      --jf-collapsed-shadow: 0 4px 16px rgba(5, 150, 105, 0.35);
      --jf-collapsed-shadow-hover: 0 6px 20px rgba(5, 150, 105, 0.4);
      --jf-progress-track: rgba(0, 0, 0, 0.05);
      --jf-primary-hover-shadow: 0 2px 8px rgba(5, 150, 105, 0.3);
      --jf-toast-bg: #065f46;
      --jf-toast-text: #ffffff;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --jf-bg: #1e293b;
        --jf-bg-subtle: #273449;
        --jf-bg-hover: #334155;
        --jf-text: #f1f5f9;
        --jf-text-secondary: #cbd5e1;
        --jf-text-muted: #94a3b8;
        --jf-text-placeholder: #64748b;
        --jf-text-disabled: #475569;
        --jf-border: #334155;
        --jf-border-strong: #475569;
        --jf-border-light: #2a3447;
        --jf-emerald-50: rgba(16, 185, 129, 0.14);
        --jf-emerald-100: rgba(16, 185, 129, 0.24);
        --jf-emerald-500: #34d399;
        --jf-emerald-600: #10b981;
        --jf-emerald-700: #6ee7b7;
        --jf-emerald-800: #a7f3d0;
        --jf-blue-50: rgba(59, 130, 246, 0.14);
        --jf-blue-200: rgba(59, 130, 246, 0.38);
        --jf-blue-700: #93c5fd;
        --jf-amber-500: #fbbf24;
        --jf-amber-600: #fcd34d;
        --jf-red-500: #f87171;
        --jf-red-600: #fca5a5;
        --jf-red-bg: rgba(239, 68, 68, 0.14);
        --jf-red-border: rgba(239, 68, 68, 0.38);
        --jf-shadow-card: 0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.4);
        --jf-shadow-toast: 0 4px 12px rgba(0, 0, 0, 0.5);
        --jf-header-gradient: linear-gradient(135deg, #065f46, #064e3b);
        --jf-collapsed-gradient: linear-gradient(135deg, #10b981, #065f46);
        --jf-collapsed-shadow: 0 4px 16px rgba(5, 150, 105, 0.5);
        --jf-collapsed-shadow-hover: 0 6px 20px rgba(5, 150, 105, 0.6);
        --jf-progress-track: rgba(255, 255, 255, 0.08);
        --jf-primary-hover-shadow: 0 2px 8px rgba(5, 150, 105, 0.45);
        --jf-toast-bg: #064e3b;
        --jf-toast-text: #ecfdf5;
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--jf-emerald-500);
      outline-offset: 2px;
    }

    #joblit-widget-root {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      max-height: 480px;
      background: var(--jf-bg);
      border-radius: 14px;
      box-shadow: var(--jf-shadow-card);
      overflow: hidden;
      font-size: 13px;
      color: var(--jf-text);
      transition: box-shadow 180ms ease, width 180ms ease, max-height 180ms ease;
    }

    /* ── Header ── */
    .jf-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 60px;
      padding: 8px 8px 8px 14px;
      background: var(--jf-header-gradient);
      color: #fff;
    }

    .jf-header-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .jf-header-logo-icon {
      display: flex;
      align-items: center;
      opacity: 0.9;
    }

    .jf-header-title {
      font-weight: 700;
      font-size: 14px;
      letter-spacing: -0.2px;
    }

    .jf-header-badge {
      background: rgba(255, 255, 255, 0.2);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }

    .jf-header-actions {
      display: flex;
      gap: 4px;
    }

    .jf-header-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      background: rgba(255, 255, 255, 0.1);
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      opacity: 0.8;
      transition: background-color 150ms ease, opacity 150ms ease;
    }

    .jf-header-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.2);
    }

    .jf-header-btn:focus-visible {
      outline-color: #fff;
    }

    /* ── Fill progress ── */
    .jf-fill-progress {
      height: 3px;
      background: var(--jf-progress-track);
      overflow: hidden;
    }

    .jf-fill-progress-bar {
      height: 100%;
      border-radius: 2px;
      transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .jf-fill-progress-bar--active {
      background: var(--jf-emerald-500);
    }

    .jf-fill-progress-bar--done {
      background: var(--jf-emerald-500);
    }

    /* ── Body ── */
    .jf-body {
      padding: 10px 14px;
      max-height: 340px;
      overflow-y: auto;
    }

    .jf-field-list {
      list-style: none;
    }

    .jf-field-item {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 48px;
      padding: 2px 0;
      border-bottom: 1px solid var(--jf-border-light);
      transition: background 100ms ease;
    }

    .jf-field-item:last-child {
      border-bottom: none;
    }

    .jf-field-item:hover {
      background: var(--jf-bg-subtle);
      margin: 0 -14px;
      padding-left: 14px;
      padding-right: 14px;
    }

    .jf-field-label {
      font-size: 12px;
      color: var(--jf-text-muted);
      max-width: 88px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .jf-field-value {
      min-width: 0;
      flex: 1;
      font-size: 12px;
      color: var(--jf-text);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-left: auto;
      text-align: right;
    }

    .jf-source-badge {
      flex-shrink: 0;
    }

    .jf-confidence {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .jf-confidence-high { background: var(--jf-emerald-500); box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15); }
    .jf-confidence-medium { background: var(--jf-amber-500); }
    .jf-confidence-low { background: var(--jf-text-disabled); }

    /* ── Footer ── */
    .jf-footer {
      padding: 10px 14px;
      border-top: 1px solid var(--jf-border-light);
      display: flex;
      gap: 8px;
    }

    .jf-btn-primary {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 9px 16px;
      min-height: 44px;
      background: var(--jf-emerald-600);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
    }

    .jf-btn-primary:hover { background: var(--jf-emerald-700); box-shadow: var(--jf-primary-hover-shadow); }
    .jf-btn-primary:active { transform: scale(0.97); }
    .jf-btn-primary:disabled { background: var(--jf-emerald-100); cursor: not-allowed; box-shadow: none; transform: none; opacity: 0.7; }

    .jf-spinner {
      display: inline-block;
      width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: jf-spin 0.6s linear infinite;
    }
    @keyframes jf-spin { to { transform: rotate(360deg); } }

    .jf-btn-secondary {
      display: inline-flex;
      align-items: center;
      padding: 9px 14px;
      min-height: 44px;
      background: var(--jf-bg-subtle);
      color: var(--jf-text-secondary);
      border: 1.5px solid var(--jf-border);
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
    }

    .jf-btn-secondary:hover { background: var(--jf-bg-hover); border-color: var(--jf-border-strong); }
    .jf-btn-secondary:active { transform: scale(0.97); }

    .jf-footer-actions {
      display: flex;
      gap: 8px;
      width: 100%;
    }
    .jf-footer-actions .jf-btn-primary { flex: 1; }
    .jf-footer-actions .jf-btn-secondary { flex-shrink: 0; }

    /* ── Collapsed badge ── */
    .jf-collapsed {
      width: 48px;
      height: 48px;
      border: none;
      padding: 0;
      appearance: none;
      -webkit-appearance: none;
      border-radius: 14px;
      background: var(--jf-collapsed-gradient);
      color: inherit;
      font: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: fixed;
      bottom: 20px;
      right: 20px;
      box-shadow: var(--jf-collapsed-shadow);
      transition: transform 180ms ease, box-shadow 180ms ease;
    }

    .jf-collapsed:focus-visible {
      outline: 2px solid var(--jf-emerald-500);
      outline-offset: 2px;
    }

    .jf-collapsed:hover {
      transform: scale(1.04);
      box-shadow: var(--jf-collapsed-shadow-hover);
    }

    .jf-collapsed:active {
      transform: scale(0.95);
    }

    .jf-collapsed-badge {
      position: absolute;
      top: -5px;
      right: -5px;
      background: var(--jf-bg);
      color: var(--jf-emerald-600);
      font-size: 10px;
      font-weight: 700;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    }

    .jf-logo {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .jf-empty {
      text-align: center;
      padding: 24px;
      color: var(--jf-text-placeholder);
      font-size: 13px;
    }

    /* ── Review bar ── */
    .jf-review-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: var(--jf-emerald-50);
      border-bottom: 1px solid var(--jf-emerald-100);
      font-size: 11px;
      font-weight: 500;
      color: var(--jf-emerald-700);
    }

    /* ── Status dots ── */
    .jf-dot-filled { background: var(--jf-emerald-500); box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15); }
    .jf-dot-edited { background: var(--jf-amber-500); box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15); }
    .jf-dot-unfilled { background: var(--jf-text-disabled); }
    .jf-dot-unknown { background: var(--jf-border); border: 1.5px dashed var(--jf-text-placeholder); }

    /* ── Field value states ── */
    .jf-field-value--edited {
      color: var(--jf-amber-600);
      font-style: italic;
    }

    .jf-field-value--empty {
      color: var(--jf-text-disabled);
      cursor: pointer;
    }

    .jf-field-value--empty:hover {
      color: var(--jf-emerald-500);
    }

    /* ── Edit button (hover reveal) ── */
    .jf-edit-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 5px;
      background: var(--jf-bg-hover);
      color: var(--jf-text-muted);
      cursor: pointer;
      flex-shrink: 0;
      margin-left: 4px;
      opacity: 0;
      transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
    }

    .jf-edit-btn:hover {
      background: var(--jf-border);
      color: var(--jf-text-secondary);
    }

    .jf-field-item:hover .jf-edit-btn,
    .jf-field-item:focus-within .jf-edit-btn {
      opacity: 1;
    }

    /* ── Inline edit ── */
    .jf-field-item--editing {
      background: var(--jf-bg-subtle);
      margin: 0 -14px;
      padding: 6px 14px;
      border-radius: 0;
    }

    .jf-edit-wrap {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
      margin-left: auto;
    }

    .jf-edit-input {
      flex: 1;
      min-width: 0;
      min-height: 44px;
      padding: 0 8px;
      border: 1.5px solid var(--jf-emerald-500);
      border-radius: 6px;
      font-size: 12px;
      color: var(--jf-text);
      background: var(--jf-bg);
      outline: none;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.1);
    }

    .jf-edit-input::placeholder {
      color: var(--jf-text-placeholder);
    }

    .jf-edit-confirm, .jf-edit-cancel {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      flex-shrink: 0;
      transition: background-color 120ms ease, color 120ms ease;
    }

    .jf-edit-confirm {
      background: var(--jf-emerald-50);
      color: var(--jf-emerald-600);
    }

    .jf-edit-confirm:hover {
      background: var(--jf-emerald-100);
    }

    .jf-edit-cancel {
      background: var(--jf-red-bg);
      color: var(--jf-red-600);
    }

    .jf-edit-cancel:hover {
      background: var(--jf-red-border);
    }

    /* ── Toast ── */
    .jf-toast {
      position: absolute;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--jf-toast-bg);
      color: var(--jf-toast-text);
      font-size: 11px;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 8px;
      box-shadow: var(--jf-shadow-toast);
      white-space: nowrap;
      animation: jf-toast-in 200ms ease, jf-toast-out 300ms ease 1.7s forwards;
      z-index: 10;
    }

    @keyframes jf-toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(8px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    @keyframes jf-toast-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }

    @media (hover: none) {
      .jf-edit-btn {
        opacity: 1;
      }
    }

    @media (max-width: 420px) {
      #joblit-widget-root {
        width: min(340px, calc(100vw - 24px)) !important;
        max-height: calc(100vh - 24px) !important;
        right: 12px !important;
        bottom: 12px !important;
      }

      .jf-body {
        max-height: calc(100vh - 148px);
      }

      .jf-field-label {
        max-width: 78px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    }
  `;
}
