import { useState, useCallback } from "react";

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
      setError("Please enter your API token");
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
                setError("Token is invalid or expired. Please check and try again.");
                chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" });
              }
            },
          );
        } else {
          setLoading(false);
          setError("Failed to save token");
        }
      },
    );
  }, [token, onConnected]);

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        Connect to Jobflow
      </h2>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
        To get started, generate an API token from your Jobflow account settings
        and paste it below.
      </p>

      <div style={{ marginBottom: 12 }}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="jfext_..."
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
        {loading ? "Connecting..." : "Connect"}
      </button>

      <p style={{ fontSize: 12, color: "#999", marginTop: 16, textAlign: "center" }}>
        Open Jobflow &rarr; Settings &rarr; Extension to generate a token
      </p>
    </div>
  );
}
