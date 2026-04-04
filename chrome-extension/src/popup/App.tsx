import { useState, useEffect, useCallback } from "react";
import { Dashboard } from "./pages/Dashboard";
import { TokenSetup } from "./pages/TokenSetup";
import { History } from "./pages/History";
import { ProfileSelect } from "./pages/ProfileSelect";
import { Options } from "./pages/Options";

type AuthState = "loading" | "setup" | "authenticated";
type Tab = "dashboard" | "history" | "profile" | "options";

const TAB_ITEMS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Home" },
  { key: "history", label: "History" },
  { key: "profile", label: "Profile" },
  { key: "options", label: "Settings" },
];

export function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

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
    checkAuth();
  }, [checkAuth]);

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
          Loading...
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
