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

interface RecentSubmission {
  id: string;
  pageDomain: string;
  atsProvider: string;
  filledCount: number;
  fieldCount: number;
  createdAt: string;
}

export function Dashboard({ onDisconnect }: DashboardProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fillState, setFillState] = useState<FillState>({ status: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const [recentSubs, setRecentSubs] = useState<RecentSubmission[]>([]);
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

    // Fetch recent submissions for history section
    chrome.runtime.sendMessage(
      { type: "GET_SUBMISSIONS", params: { limit: 5 } },
      (response) => {
        if (response?.success && Array.isArray(response.data)) {
          setRecentSubs(response.data);
        }
      },
    );

    return () => {
      if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
    };
  }, []);

  const handleRefreshProfile = useCallback(() => {
    setRefreshing(true);
    chrome.runtime.sendMessage({ type: "GET_FLAT_PROFILE", force: true }, (response) => {
      setRefreshing(false);
      if (response?.success && response.data) {
        setProfile(response.data);
        setError("");
      }
    });
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
            const filled = response.filled ?? 0;
            const skipped = response.skipped ?? 0;
            const total = filled + skipped;

            if (total === 0) {
              // No form fields detected — show informative message, don't auto-close
              setFillState({
                status: "error",
                message: response.message || t("widget.noFields"),
              });
              return;
            }

            const fields = Array.isArray(response.fields) ? response.fields : [];
            const sources = {
              profile: fields.filter((f: any) => f.filled && f.source === "profile").length,
              historical: fields.filter((f: any) => f.filled && f.source === "historical").length,
              default: 0,
            };
            setFillState({
              status: "success",
              filled,
              total,
              message: response.message,
              sources,
            });
            // Auto-close after showing result
            setTimeout(() => window.close(), 2000);
          } else {
            // Content script responded without fill data — treat as no fields
            setFillState({
              status: "error",
              message: t("widget.noFields"),
            });
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
            <div style={{ minWidth: 0, flex: 1 }}>
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
            <button
              onClick={handleRefreshProfile}
              className="jl-btn jl-btn--ghost"
              title="Refresh profile"
              style={{ padding: 6, flexShrink: 0, opacity: refreshing ? 0.5 : 0.6 }}
              disabled={refreshing}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}>
                <path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M8 0l3 2-3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
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

      {/* Recent Submissions */}
      {recentSubs.length > 0 && (
        <>
          <hr className="jl-divider" />
          <div className="jl-section-label" style={{ margin: 0, fontSize: 11 }}>
            {t("history.title")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recentSubs.map((sub) => {
              const ratio = sub.fieldCount > 0
                ? Math.round((sub.filledCount / sub.fieldCount) * 100)
                : 0;
              const seconds = Math.floor((Date.now() - new Date(sub.createdAt).getTime()) / 1000);
              const timeAgo = seconds < 60 ? "just now"
                : seconds < 3600 ? `${Math.floor(seconds / 60)}m`
                : seconds < 86400 ? `${Math.floor(seconds / 3600)}h`
                : `${Math.floor(seconds / 86400)}d`;
              return (
                <div key={sub.id} className="jl-card" style={{ padding: "6px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 500, color: "var(--jl-text-primary)",
                      maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {sub.pageDomain}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 4,
                        background: ratio >= 80 ? "#f0fdf4" : ratio >= 50 ? "#fffbeb" : "#fef2f2",
                        color: ratio >= 80 ? "#065f46" : ratio >= 50 ? "#854d0e" : "#991b1b",
                        fontWeight: 500,
                      }}>
                        {sub.filledCount}/{sub.fieldCount}
                      </span>
                      <span style={{ fontSize: 9, color: "var(--jl-text-muted)" }}>{timeAgo}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

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
