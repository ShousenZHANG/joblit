import { useState, useEffect, useCallback } from "react";
import { STORAGE_KEYS, DEFAULT_API_BASE } from "@ext/shared/constants";
import { t } from "@ext/shared/i18n";

interface TokenSetupProps {
  onConnected: () => void;
}

export function TokenSetup({ onConnected }: TokenSetupProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.API_BASE, (result) => {
      if (result[STORAGE_KEYS.API_BASE]) {
        setApiBase(result[STORAGE_KEYS.API_BASE]);
      }
    });
  }, []);

  const handleConnect = useCallback(async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError(t("auth.tokenEmpty"));
      return;
    }

    if (!trimmed.startsWith("jfext_")) {
      setError(t("auth.tokenInvalid"));
      return;
    }

    // Save API base before connecting
    const baseToUse = apiBase.trim() || DEFAULT_API_BASE;
    await chrome.storage.local.set({ [STORAGE_KEYS.API_BASE]: baseToUse });

    setLoading(true);
    setError("");

    chrome.runtime.sendMessage(
      { type: "SET_TOKEN", token: trimmed },
      (response) => {
        if (response?.success) {
          // Verify the token works by fetching profile
          chrome.runtime.sendMessage(
            { type: "GET_PROFILE" },
            (profileResponse) => {
              setLoading(false);
              if (profileResponse?.success) {
                onConnected();
              } else {
                const serverError = profileResponse?.error ?? "";
                if (serverError.includes("fetch") || serverError.includes("network") || serverError.includes("Failed")) {
                  setError(t("auth.networkError", { base: baseToUse }));
                } else {
                  setError(t("auth.tokenInvalid"));
                }
                chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" });
              }
            },
          );
        } else {
          setLoading(false);
          setError(t("error.unknown"));
        }
      },
    );
  }, [token, apiBase, onConnected]);

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        {t("auth.connect")}
      </h2>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
        {t("auth.connectDesc")}
      </p>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
          {t("options.apiBase")}
        </div>
        <input
          type="url"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder={DEFAULT_API_BASE}
          style={{
            width: "100%",
            padding: "6px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
            boxSizing: "border-box",
            color: "#475569",
            background: "#f8fafc",
          }}
        />
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {t("auth.apiBaseHint")}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
          Token
        </div>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("auth.tokenPlaceholder")}
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 14,
            boxSizing: "border-box",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConnect();
          }}
        />
      </div>

      {error && (
        <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 12, lineHeight: 1.4 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={loading}
        style={{
          width: "100%",
          padding: "10px 16px",
          background: loading ? "#888" : "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? t("auth.connecting") : t("auth.connect")}
      </button>

      <p style={{ fontSize: 12, color: "#999", marginTop: 16, textAlign: "center" }}>
        {t("auth.setupHint")}
      </p>
    </div>
  );
}
