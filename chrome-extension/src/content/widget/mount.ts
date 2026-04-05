/**
 * Mount the floating widget inside a Shadow DOM to isolate styles
 * from the host page.
 */

const WIDGET_HOST_ID = "joblit-autofill-widget";

export function mountWidget(): { shadowRoot: ShadowRoot; container: HTMLDivElement } | null {
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
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    #joblit-widget-root {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      max-height: 480px;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
      overflow: hidden;
      font-size: 13px;
      color: #1a1a1a;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* ── Header ── */
    .jf-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: linear-gradient(135deg, #10b981, #047857);
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
      width: 26px;
      height: 26px;
      background: rgba(255, 255, 255, 0.1);
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      opacity: 0.8;
      transition: all 150ms ease;
    }

    .jf-header-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.2);
    }

    /* ── Fill progress ── */
    .jf-fill-progress {
      height: 3px;
      background: rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }

    .jf-fill-progress-bar {
      height: 100%;
      border-radius: 2px;
      transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .jf-fill-progress-bar--active {
      background: #10b981;
    }

    .jf-fill-progress-bar--done {
      background: #10b981;
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
      padding: 7px 0;
      border-bottom: 1px solid #f3f4f6;
      transition: background 100ms ease;
    }

    .jf-field-item:last-child {
      border-bottom: none;
    }

    .jf-field-item:hover {
      background: #f9fafb;
      margin: 0 -14px;
      padding-left: 14px;
      padding-right: 14px;
    }

    .jf-field-label {
      font-size: 12px;
      color: #6b7280;
      max-width: 100px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .jf-field-value {
      font-size: 12px;
      color: #111827;
      font-weight: 500;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-left: auto;
    }

    .jf-confidence {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .jf-confidence-high { background: #10b981; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15); }
    .jf-confidence-medium { background: #f59e0b; }
    .jf-confidence-low { background: #d1d5db; }

    /* ── Footer ── */
    .jf-footer {
      padding: 10px 14px;
      border-top: 1px solid #f3f4f6;
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
      background: #059669;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 150ms ease;
    }

    .jf-btn-primary:hover { background: #047857; box-shadow: 0 2px 8px rgba(5, 150, 105, 0.3); }
    .jf-btn-primary:active { transform: scale(0.97); }

    .jf-btn-secondary {
      display: inline-flex;
      align-items: center;
      padding: 9px 14px;
      background: #f8fafc;
      color: #475569;
      border: 1.5px solid #e5e7eb;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 150ms ease;
    }

    .jf-btn-secondary:hover { background: #f1f5f9; border-color: #d1d5db; }
    .jf-btn-secondary:active { transform: scale(0.97); }

    /* ── Collapsed badge ── */
    .jf-collapsed {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, #10b981, #047857);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: fixed;
      bottom: 20px;
      right: 20px;
      box-shadow: 0 4px 16px rgba(5, 150, 105, 0.35);
      transition: all 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .jf-collapsed:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(5, 150, 105, 0.4);
    }

    .jf-collapsed:active {
      transform: scale(0.95);
    }

    .jf-collapsed--has-fields {
      animation: jf-pulse 2.5s ease infinite;
    }

    .jf-collapsed-badge {
      position: absolute;
      top: -5px;
      right: -5px;
      background: #fff;
      color: #059669;
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
      color: #9ca3af;
      font-size: 13px;
    }

    /* ── Review bar ── */
    .jf-review-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: #ecfdf5;
      border-bottom: 1px solid #d1fae5;
      font-size: 11px;
      font-weight: 500;
      color: #047857;
    }

    /* ── Status dots ── */
    .jf-dot-filled { background: #10b981; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15); }
    .jf-dot-edited { background: #f59e0b; box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15); }
    .jf-dot-unfilled { background: #d1d5db; }
    .jf-dot-unknown { background: #e5e7eb; border: 1.5px dashed #9ca3af; }

    /* ── Field value states ── */
    .jf-field-value--edited {
      color: #d97706;
      font-style: italic;
    }

    .jf-field-value--empty {
      color: #d1d5db;
      cursor: pointer;
    }

    .jf-field-value--empty:hover {
      color: #10b981;
    }

    /* ── Edit button (hover reveal) ── */
    .jf-edit-btn {
      display: none;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 5px;
      background: #f3f4f6;
      color: #6b7280;
      cursor: pointer;
      flex-shrink: 0;
      margin-left: 4px;
      transition: all 100ms ease;
    }

    .jf-edit-btn:hover {
      background: #e5e7eb;
      color: #374151;
    }

    .jf-field-item:hover .jf-edit-btn {
      display: flex;
    }

    /* ── Inline edit ── */
    .jf-field-item--editing {
      background: #f9fafb;
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
      height: 26px;
      padding: 0 8px;
      border: 1.5px solid #10b981;
      border-radius: 6px;
      font-size: 12px;
      color: #111827;
      background: #fff;
      outline: none;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.1);
    }

    .jf-edit-input::placeholder {
      color: #d1d5db;
    }

    .jf-edit-confirm, .jf-edit-cancel {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 100ms ease;
    }

    .jf-edit-confirm {
      background: #ecfdf5;
      color: #059669;
    }

    .jf-edit-confirm:hover {
      background: #d1fae5;
    }

    .jf-edit-cancel {
      background: #fef2f2;
      color: #dc2626;
    }

    .jf-edit-cancel:hover {
      background: #fecaca;
    }

    /* ── Animations ── */
    @keyframes jf-pulse {
      0%, 100% { box-shadow: 0 4px 16px rgba(5, 150, 105, 0.35); }
      50%      { box-shadow: 0 4px 16px rgba(5, 150, 105, 0.35), 0 0 0 6px rgba(16, 185, 129, 0); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;
}
