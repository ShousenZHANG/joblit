import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from "react";
import { Dashboard } from "./pages/Dashboard";
import { TokenSetup } from "./pages/TokenSetup";
import { ProfileSelect } from "./pages/ProfileSelect";
import { Options } from "./pages/Options";

import { useI18n } from "@ext/shared/useI18n";
import { logoIconSvg } from "@ext/shared/logo";

type AuthState = "loading" | "setup" | "authenticated" | "error";
type Tab = "dashboard" | "profile" | "options";
const TAB_KEYS: Tab[] = ["dashboard", "profile", "options"];

const TAB_ICONS: Record<Tab, string> = {
  dashboard: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>`,
  profile: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  options: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
};

// Full-page settings mode (?view=settings): complex configuration cannot live
// in the popup — chrome.permissions.request() and any focus loss close it,
// wiping the form. The same bundle rendered in a tab has neither problem.
const IS_SETTINGS_PAGE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("view") === "settings";

export function App() {
  const { t, ready } = useI18n();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    dashboard: null,
    profile: null,
    options: null,
  });

  const TAB_ITEMS: { key: Tab; label: string }[] = [
    { key: "dashboard", label: t("tab.home") },
    { key: "profile", label: t("tab.profile") },
    { key: "options", label: t("tab.settings") },
  ];

  const checkAuth = useCallback(() => {
    chrome.runtime.sendMessage({ type: "GET_AUTH_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setAuthState("error");
        return;
      }
      if (response?.success && response.data?.authenticated) {
        setAuthState("authenticated");
      } else {
        setAuthState("setup");
      }
    });
  }, []);

  useEffect(() => {
    if (ready) checkAuth();
  }, [checkAuth, ready]);

  const handleTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, currentTab: Tab) => {
    const currentIndex = TAB_KEYS.indexOf(currentTab);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TAB_KEYS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TAB_KEYS.length) % TAB_KEYS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TAB_KEYS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TAB_KEYS[nextIndex];
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }, []);

  if (!ready) {
    return (
      <div className={`jl-app${IS_SETTINGS_PAGE ? " jl-app--page" : ""}`}>
        <div className="jl-loading">
          <div className="jl-spinner" />
          <span className="jl-loading-text">{t("app.loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`jl-app${IS_SETTINGS_PAGE ? " jl-app--page" : ""}`}>
      {/* Header */}
      <header className="jl-header">
        <div className="jl-header-logo">
          <div
            className="jl-header-icon"
            dangerouslySetInnerHTML={{ __html: logoIconSvg(20) }}
          />
          <span className="jl-header-wordmark">Joblit</span>
        </div>
        <span className="jl-header-badge">AutoFill</span>
      </header>

      {authState === "loading" && (
        <div className="jl-loading" role="status" aria-live="polite">
          <div className="jl-spinner" />
          <span className="jl-loading-text">{t("app.loading")}</span>
        </div>
      )}

      {authState === "error" && (
        <div className="jl-auth-error" role="alert">
          <div className="jl-state-icon jl-state-icon--neutral" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 8v4m0 4h.01M4.9 19h14.2a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.17 16A2 2 0 0 0 4.9 19Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </div>
          <h2>{t("app.unavailable")}</h2>
          <p>{t("app.unavailableDesc")}</p>
          <button
            className="jl-btn jl-btn--primary"
            onClick={() => {
              setAuthState("loading");
              checkAuth();
            }}
          >
            {t("app.retry")}
          </button>
        </div>
      )}

      {authState === "setup" && (
        <div className="jl-content">
          <TokenSetup onConnected={checkAuth} />
        </div>
      )}

      {authState === "authenticated" && IS_SETTINGS_PAGE && (
        <main className="jl-content">
          <Options onDisconnect={checkAuth} variant="page" />
        </main>
      )}

      {authState === "authenticated" && !IS_SETTINGS_PAGE && (
        <>
          {/* Tab Bar */}
          <nav className="jl-tabs" role="tablist" aria-label={t("tabs.ariaLabel")}>
            {TAB_ITEMS.map(({ key, label }) => (
              <button
                key={key}
                ref={(element) => { tabRefs.current[key] = element; }}
                id={`jl-tab-${key}`}
                role="tab"
                type="button"
                aria-selected={activeTab === key}
                aria-controls={`jl-panel-${key}`}
                tabIndex={activeTab === key ? 0 : -1}
                onClick={() => setActiveTab(key)}
                onKeyDown={(event) => handleTabKeyDown(event, key)}
                className={`jl-tab ${activeTab === key ? "jl-tab--active" : ""}`}
              >
                <span
                  className="jl-tab-icon"
                  dangerouslySetInnerHTML={{ __html: TAB_ICONS[key] }}
                />
                {label}
              </button>
            ))}
          </nav>

          {/* Tab Content */}
          <main
            className="jl-content"
            id={`jl-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`jl-tab-${activeTab}`}
            tabIndex={-1}
            key={activeTab}
          >
            {activeTab === "dashboard" && <Dashboard />}
            {activeTab === "profile" && <ProfileSelect />}
            {activeTab === "options" && <Options onDisconnect={checkAuth} />}
          </main>
        </>
      )}
    </div>
  );
}
