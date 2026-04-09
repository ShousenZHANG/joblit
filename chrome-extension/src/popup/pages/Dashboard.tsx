import { useState, useEffect, useCallback, useRef } from "react";
import { t } from "@ext/shared/i18n";
import { logoIconSvg, checkmarkSvg, spinnerSvg } from "@ext/shared/logo";

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

type FillState =
  | { status: "idle" }
  | { status: "filling" }
  | { status: "success"; filled: number; total: number; message?: string; sources?: { profile: number; historical: number; default: number } }
  | { status: "error"; message: string };

export function Dashboard({ onDisconnect }: DashboardProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fillState, setFillState] = useState<FillState>({ status: "idle" });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    return () => {
      if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
    };
  }, []);

  const handleFillNow = useCallback(() => {
    setFillState({ status: "filling" });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TRIGGER_FILL" }, (response) => {
          if (chrome.runtime.lastError) {
            setFillState({ status: "error", message: t("error.fillFailed") });
            return;
          }
          if (response?.filled !== undefined) {
            const fields = Array.isArray(response.fields) ? response.fields : [];
            const sources = {
              profile: fields.filter((f: any) => f.filled && f.source === "profile").length,
              historical: fields.filter((f: any) => f.filled && f.source === "historical").length,
              default: 0,
            };
            setFillState({
              status: "success",
              filled: response.filled ?? 0,
              total: (response.filled ?? 0) + (response.skipped ?? 0),
              message: response.message,
              sources,
            });
            // Auto-close after showing result
            setTimeout(() => window.close(), 2000);
          } else {
            setFillState({
              status: "success",
              filled: 0,
              total: 0,
              message: "Fill triggered",
            });
            setTimeout(() => window.close(), 1500);
          }
        });
      } else {
        setFillState({ status: "error", message: "No active tab found" });
      }
    });
  }, []);

  const handleToggleWidget = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_WIDGET" }, () => {
          void chrome.runtime.lastError;
        });
      }
    });
  }, []);

  const handleDisconnect = useCallback(() => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      disconnectTimer.current = setTimeout(() => setConfirmDisconnect(false), 3000);
      return;
    }
    chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" }, () => {
      onDisconnect();
    });
  }, [confirmDisconnect, onDisconnect]);

  // Initial for avatar
  const initial = (profile?.flat?.fullName ?? "?")[0].toUpperCase();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Profile Card */}
      <div className="jl-card jl-card--emerald">
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="jl-skeleton" style={{ width: 120, height: 16 }} />
            <div className="jl-skeleton" style={{ width: 180, height: 12 }} />
            <div className="jl-skeleton" style={{ width: 140, height: 12 }} />
          </div>
        ) : profile ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: "var(--jl-emerald-100)", color: "var(--jl-emerald-700)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 16, flexShrink: 0,
            }}>
              {initial}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--jl-text-primary)" }}>
                {profile.flat?.fullName ?? "—"}
              </div>
              <div style={{ fontSize: 12, color: "var(--jl-text-secondary)", marginTop: 1 }}>
                {profile.flat?.currentTitle}
                {profile.flat?.currentCompany ? ` @ ${profile.flat.currentCompany}` : ""}
              </div>
              <div style={{ fontSize: 11, color: "var(--jl-text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                <span>{profile.flat?.email}</span>
                <span style={{ color: "var(--jl-border)" }}>&middot;</span>
                <span className="jl-badge jl-badge--success" style={{ fontSize: 10 }}>
                  {t("auth.connected")}
                </span>
              </div>
            </div>
          </div>
        ) : error ? (
          <div style={{ color: "var(--jl-error)", fontSize: 13 }}>{error}</div>
        ) : (
          <div style={{ color: "var(--jl-text-muted)", fontSize: 13 }}>
            {t("dashboard.noProfile")}
          </div>
        )}
      </div>

      {/* Fill Button with State */}
      {fillState.status === "idle" && (
        <button onClick={handleFillNow} className="jl-btn jl-btn--primary">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 12l3-8h6l3 8M4.5 8h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {t("dashboard.fillNow")}
        </button>
      )}

      {fillState.status === "filling" && (
        <div className="jl-card" style={{ textAlign: "center", padding: "16px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
            <span dangerouslySetInnerHTML={{ __html: spinnerSvg(16) }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--jl-emerald-700)" }}>
              Filling form fields...
            </span>
          </div>
          <div className="jl-progress">
            <div className="jl-progress-bar jl-progress-bar--indeterminate" />
          </div>
        </div>
      )}

      {fillState.status === "success" && (
        <div className="jl-card" style={{ textAlign: "center", padding: "16px 14px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div
              className="jl-success-check"
              style={{ width: 36, height: 36 }}
              dangerouslySetInnerHTML={{ __html: checkmarkSvg(20) }}
            />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--jl-emerald-700)" }}>
              {fillState.filled}/{fillState.total} fields filled
            </div>
            {fillState.total > fillState.filled && (
              <div className="jl-badge jl-badge--warning" style={{ fontSize: 11 }}>
                {fillState.total - fillState.filled} skipped
              </div>
            )}
            {fillState.sources && (fillState.sources.profile > 0 || fillState.sources.historical > 0) && (
              <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 4 }}>
                {fillState.sources.profile > 0 && (
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#f0fdf4", color: "#065f46", border: "1px solid #d1fae5" }}>
                    {fillState.sources.profile} from profile
                  </span>
                )}
                {fillState.sources.historical > 0 && (
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe" }}>
                    {fillState.sources.historical} from history
                  </span>
                )}
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--jl-text-muted)", marginTop: 2 }}>
              Closing in a moment...
            </div>
          </div>
        </div>
      )}

      {fillState.status === "error" && (
        <div>
          <div className="jl-error-msg" style={{ marginBottom: 8 }}>
            <span>{fillState.message}</span>
          </div>
          <button onClick={() => setFillState({ status: "idle" })} className="jl-btn jl-btn--outline" style={{ width: "100%" }}>
            Try Again
          </button>
        </div>
      )}

      {/* Shortcut & Widget toggle */}
      <div style={{ display: "flex", gap: 8 }}>
        <div className="jl-kbd" style={{ flex: 1, justifyContent: "center" }}>
          Alt+Shift+F
        </div>
        <button onClick={handleToggleWidget} className="jl-btn jl-btn--outline" style={{ flex: 1 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="11" cy="8" r="2" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          {t("dashboard.toggleWidget")}
        </button>
      </div>

      <hr className="jl-divider" />

      {/* Disconnect */}
      <button
        onClick={handleDisconnect}
        className={`jl-btn ${confirmDisconnect ? "jl-btn--danger" : "jl-btn--ghost"}`}
        style={{ width: "100%", fontSize: 12 }}
      >
        {confirmDisconnect ? "Click again to confirm disconnect" : t("auth.disconnect")}
      </button>
    </div>
  );
}
