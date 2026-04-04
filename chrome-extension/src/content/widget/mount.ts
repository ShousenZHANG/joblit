/**
 * Mount the floating widget inside a Shadow DOM to isolate styles
 * from the host page.
 */

const WIDGET_HOST_ID = "jobflow-autofill-widget";

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
  container.id = "jobflow-widget-root";
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

    #jobflow-widget-root {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      max-height: 480px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
      overflow: hidden;
      font-size: 13px;
      color: #1a1a1a;
      transition: all 0.2s ease;
    }

    .jf-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #2563eb;
      color: #fff;
      cursor: move;
    }

    .jf-header-title {
      font-weight: 600;
      font-size: 14px;
    }

    .jf-header-badge {
      background: rgba(255, 255, 255, 0.2);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
    }

    .jf-header-actions {
      display: flex;
      gap: 8px;
    }

    .jf-header-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      font-size: 16px;
      opacity: 0.8;
      padding: 2px;
    }

    .jf-header-btn:hover {
      opacity: 1;
    }

    .jf-body {
      padding: 12px 16px;
      max-height: 360px;
      overflow-y: auto;
    }

    .jf-field-list {
      list-style: none;
    }

    .jf-field-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
    }

    .jf-field-item:last-child {
      border-bottom: none;
    }

    .jf-field-label {
      font-size: 12px;
      color: #666;
      max-width: 100px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .jf-field-value {
      font-size: 12px;
      color: #1a1a1a;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .jf-confidence {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .jf-confidence-high { background: #22c55e; }
    .jf-confidence-medium { background: #eab308; }
    .jf-confidence-low { background: #9ca3af; }

    .jf-footer {
      padding: 12px 16px;
      border-top: 1px solid #f0f0f0;
      display: flex;
      gap: 8px;
    }

    .jf-btn-primary {
      flex: 1;
      padding: 8px 16px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .jf-btn-primary:hover { background: #1d4ed8; }

    .jf-btn-secondary {
      padding: 8px 12px;
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }

    .jf-btn-secondary:hover { background: #e2e8f0; }

    /* Collapsed / badge state */
    .jf-collapsed {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #2563eb;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: fixed;
      bottom: 20px;
      right: 20px;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
    }

    .jf-collapsed:hover {
      transform: scale(1.1);
    }

    .jf-collapsed-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #22c55e;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .jf-logo {
      color: #fff;
      font-weight: 800;
      font-size: 18px;
    }

    .jf-empty {
      text-align: center;
      padding: 24px;
      color: #888;
      font-size: 13px;
    }
  `;
}
