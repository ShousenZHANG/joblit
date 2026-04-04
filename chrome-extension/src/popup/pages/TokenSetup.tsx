import { useState, useCallback } from "react";
import { t } from "@ext/shared/i18n";

interface TokenSetupProps {
  onConnected: () => void;
}

export function TokenSetup({ onConnected }: TokenSetupProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConnect = useCallback(async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError(t("auth.tokenEmpty"));
      return;
    }

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
                setError(t("auth.tokenInvalid"));
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
  }, [token, onConnected]);

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        {t("auth.connect")}
      </h2>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
        {t("auth.connectDesc")}
      </p>

      <div style={{ marginBottom: 12 }}>
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
        <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>
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
