import { useState, useEffect, useCallback } from "react";
import { Dashboard } from "./pages/Dashboard";
import { TokenSetup } from "./pages/TokenSetup";

type Page = "loading" | "setup" | "dashboard";

export function App() {
  const [page, setPage] = useState<Page>("loading");

  const checkAuth = useCallback(() => {
    chrome.runtime.sendMessage({ type: "GET_AUTH_STATUS" }, (response) => {
      if (response?.success && response.data?.authenticated) {
        setPage("dashboard");
      } else {
        setPage("setup");
      }
    });
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <div style={{ width: 360, minHeight: 400, fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Jobflow</div>
        <div style={{ fontSize: 12, color: "#888" }}>AutoFill</div>
      </header>

      {page === "loading" && (
        <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
          Loading...
        </div>
      )}

      {page === "setup" && <TokenSetup onConnected={checkAuth} />}

      {page === "dashboard" && <Dashboard onDisconnect={checkAuth} />}
    </div>
  );
}
