import { useState, useEffect, useCallback } from "react";
import { Dashboard } from "./pages/Dashboard";
import { TokenSetup } from "./pages/TokenSetup";
import { History } from "./pages/History";
import { ProfileSelect } from "./pages/ProfileSelect";
import { Options } from "./pages/Options";
import { useI18n } from "@ext/shared/useI18n";

type AuthState = "loading" | "setup" | "authenticated";
type Tab = "dashboard" | "history" | "profile" | "options";

export function App() {
  const { t, ready } = useI18n();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const TAB_ITEMS: { key: Tab; label: string }[] = [
    { key: "dashboard", label: t("tab.home") },
    { key: "history", label: t("tab.history") },
    { key: "profile", label: t("tab.profile") },
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
      <div style={{ width: 360, minHeight: 400, fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 40, color: "#888" }}>
        {t("app.loading")}
      </div>
    );
  }

  return (
    <div style={{ width: 360, minHeight: 400, fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb" }}>Jobflow</div>
        <div style={{ fontSize: 11, color: "#888" }}>AutoFill</div>
      </header>

      {authState === "loading" && (
        <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
          {t("app.loading")}
        </div>
      )}

      {authState === "setup" && (
        <div style={{ padding: 16 }}>
          <TokenSetup onConnected={checkAuth} />
        </div>
      )}

      {authState === "authenticated" && (
        <>
          {/* Tab Bar */}
          <nav
            style={{
              display: "flex",
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            {TAB_ITEMS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === key ? "2px solid #2563eb" : "2px solid transparent",
                  color: activeTab === key ? "#2563eb" : "#888",
                  fontSize: 13,
                  fontWeight: activeTab === key ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Tab Content */}
          <div style={{ padding: 16 }}>
            {activeTab === "dashboard" && <Dashboard onDisconnect={checkAuth} />}
            {activeTab === "history" && <History />}
            {activeTab === "profile" && <ProfileSelect />}
            {activeTab === "options" && <Options />}
          </div>
        </>
      )}
    </div>
  );
}
