import { useState, useEffect, useCallback } from "react";
import { t } from "@ext/shared/i18n";

interface DashboardProps {
  onDisconnect: () => void;
}

interface ProfileData {
  profileName?: string;
  locale?: string;
  flat?: {
    fullName?: string;
    email?: string;
    currentTitle?: string;
    currentCompany?: string;
  };
}

export function Dashboard({ onDisconnect }: DashboardProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_FLAT_PROFILE" }, (response) => {
      setLoading(false);
      if (chrome.runtime.lastError) {
        setError(t("error.network"));
        return;
      }
      if (response?.success && response.data) {
        setProfile(response.data);
      } else if (response?.error) {
        setError(response.error);
      }
    });
  }, []);

  const handleDisconnect = useCallback(() => {
    chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" }, () => {
      onDisconnect();
    });
  }, [onDisconnect]);

  const handleFillNow = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TRIGGER_FILL" });
        window.close();
      }
    });
  }, []);

  return (
    <div>
      <div style={{
        background: "#f0f9ff",
        border: "1px solid #bae6fd",
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, color: "#0369a1", fontWeight: 600, marginBottom: 4 }}>
          {t("auth.connected")}
        </div>
        {loading ? (
          <div style={{ color: "#666", fontSize: 13 }}>{t("app.loading")}</div>
        ) : profile ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {profile.flat?.fullName ?? "—"}
            </div>
            <div style={{ fontSize: 13, color: "#555" }}>
              {profile.flat?.currentTitle}
              {profile.flat?.currentCompany ? ` @ ${profile.flat.currentCompany}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              {profile.flat?.email} &middot; {profile.profileName} ({profile.locale})
            </div>
          </>
        ) : error ? (
          <div style={{ color: "#dc2626", fontSize: 13 }}>
            {error}
          </div>
        ) : (
          <div style={{ color: "#666", fontSize: 13 }}>
            {t("dashboard.noProfile")}
          </div>
        )}
      </div>

      <button
        onClick={handleFillNow}
        style={{
          width: "100%",
          padding: "10px 16px",
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          marginBottom: 8,
        }}
      >
        {t("dashboard.fillNow")}
      </button>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={handleFillNow}
          style={{
            flex: 1,
            padding: "8px",
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Alt+Shift+F
        </button>
        <button
          onClick={() => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_WIDGET" });
              }
            });
          }}
          style={{
            flex: 1,
            padding: "8px",
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {t("dashboard.toggleWidget")}
        </button>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />

      <button
        onClick={handleDisconnect}
        style={{
          width: "100%",
          padding: "8px 16px",
          background: "transparent",
          color: "#dc2626",
          border: "1px solid #fecaca",
          borderRadius: 6,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        {t("auth.disconnect")}
      </button>
    </div>
  );
}
