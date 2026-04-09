import { useState, useEffect, useCallback } from "react";
import { Dashboard } from "./pages/Dashboard";
import { TokenSetup } from "./pages/TokenSetup";
import { ProfileSelect } from "./pages/ProfileSelect";
import { Options } from "./pages/Options";
import { RulesViewer } from "./pages/RulesViewer";
import { useI18n } from "@ext/shared/useI18n";
import { logoIconSvg } from "@ext/shared/logo";

type AuthState = "loading" | "setup" | "authenticated";
type Tab = "dashboard" | "profile" | "rules" | "options";

const TAB_ICONS: Record<Tab, string> = {
  dashboard: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>`,
  profile: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  rules: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 6.5h12M2 10h8M2 13.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  options: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
};

export function App() {
  const { t, ready } = useI18n();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const TAB_ITEMS: { key: Tab; label: string }[] = [
    { key: "dashboard", label: t("tab.home") },
    { key: "profile", label: t("tab.profile") },
    { key: "rules", label: t("tab.rules") },
    { key: "options", label: t("tab.settings") },
  ];

  const checkAuth = useCallback(() => {
    chrome.runtime.sendMessage({ type: "GET_AUTH_STATUS" }, (response) => {
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

  if (!ready) {
    return (
      <div className="jl-app">
        <div className="jl-loading">
          <div className="jl-spinner" />
          <span className="jl-loading-text">{t("app.loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="jl-app">
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
        <div className="jl-loading">
          <div className="jl-spinner" />
          <span className="jl-loading-text">{t("app.loading")}</span>
        </div>
      )}

      {authState === "setup" && (
        <div className="jl-content">
          <TokenSetup onConnected={checkAuth} />
        </div>
      )}

      {authState === "authenticated" && (
        <>
          {/* Tab Bar */}
          <nav className="jl-tabs">
            {TAB_ITEMS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
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
          <div className="jl-content" key={activeTab}>
            {activeTab === "dashboard" && <Dashboard onDisconnect={checkAuth} />}
            {activeTab === "profile" && <ProfileSelect />}
            {activeTab === "rules" && <RulesViewer />}
            {activeTab === "options" && <Options />}
          </div>
        </>
      )}
    </div>
  );
}
