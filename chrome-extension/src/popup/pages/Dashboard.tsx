import { useState, useEffect, useCallback } from "react";
import { t } from "@ext/shared/i18n";
import { checkmarkSvg, spinnerSvg } from "@ext/shared/logo";

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

export function Dashboard() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fillState, setFillState] = useState<FillState>({ status: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const [recentSubs, setRecentSubs] = useState<RecentSubmission[]>([]);
  // Capture render time once via useState lazy initializer (allowed to be
  // impure) so the recent-submissions list can compute relative ages without
  // calling Date.now() during render.
  const [renderedAt] = useState(() => Date.now());

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
      { type: "GET_SUBMISSIONS", params: { limit: 3 } },
      (response) => {
        if (response?.success && Array.isArray(response.data)) {
          setRecentSubs(response.data);
        }
      },
    );
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

    chrome.runtime.sendMessage({ type: "FILL_ACTIVE_TAB" }, (response) => {
      if (chrome.runtime.lastError) {
        setFillState({ status: "error", message: t("error.fillFailed") });
        return;
      }
      if (response?.success === false && response?.filled === undefined) {
        setFillState({
          status: "error",
          message: response.error?.includes("No active tab")
            ? t("error.noActiveTab")
            : t("error.fillFailed"),
        });
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

        const fields: Array<{ filled?: unknown; source?: unknown }> =
          Array.isArray(response.fields) ? response.fields : [];
        const sources = {
          profile: fields.filter((f) => f.filled && f.source === "profile").length,
          historical: fields.filter((f) => f.filled && f.source === "historical").length,
          default: 0,
        };
        setFillState({
          status: "success",
          filled,
          total,
          message: response.message,
          sources,
        });
      } else {
        // Content script responded without fill data — treat as no fields
        setFillState({
          status: "error",
          message: t("widget.noFields"),
        });
      }
    });
  }, []);

  const handleToggleWidget = useCallback(() => {
    chrome.runtime.sendMessage({ type: "TOGGLE_ACTIVE_TAB" }, () => {
      void chrome.runtime.lastError;
    });
  }, []);

  // Initial for avatar
  const initial = (profile?.flat?.fullName || "?")[0].toUpperCase();

  return (
    <div className="jl-page-stack">
      <section className="jl-profile-summary" aria-label={t("dashboard.profileSummary")}>
        {loading ? (
          <div className="jl-skeleton-stack" aria-label={t("dashboard.loadingProfile")}>
            <div className="jl-skeleton" style={{ width: 118, height: 15 }} />
            <div className="jl-skeleton" style={{ width: 178, height: 11 }} />
          </div>
        ) : profile ? (
          <>
            <div className="jl-avatar" aria-hidden="true">{initial}</div>
            <div className="jl-profile-copy">
              <div className="jl-profile-name">{profile.flat?.fullName ?? "—"}</div>
              <div className="jl-profile-role">
                {profile.flat?.currentTitle || profile.profileName || t("profile.active")}
                {profile.flat?.currentCompany ? ` · ${profile.flat.currentCompany}` : ""}
              </div>
              <div className="jl-profile-meta">
                <span>{profile.flat?.email}</span>
                <span className="jl-status-dot" aria-hidden="true" />
                <span>{t("auth.connected")}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRefreshProfile}
              className="jl-icon-btn"
              title={t("dashboard.refreshProfile")}
              aria-label={t("dashboard.refreshProfile")}
              aria-busy={refreshing}
              disabled={refreshing}
            >
              <svg className={refreshing ? "jl-icon--spinning" : ""} width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M8 0l3 2-3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        ) : (
          <div className={`jl-inline-state ${error ? "jl-inline-state--error" : ""}`} role={error ? "alert" : "status"}>
            {error || t("dashboard.noProfile")}
          </div>
        )}
      </section>

      <section
        className={`jl-action-surface jl-action-surface--${fillState.status}`}
        data-state={fillState.status}
        aria-busy={fillState.status === "filling"}
      >
        <span
          className="jl-sr-only"
          role={fillState.status === "error" ? "alert" : "status"}
          aria-live={fillState.status === "error" ? "assertive" : "polite"}
        >
          {fillState.status === "idle" && t("dashboard.readyTitle")}
          {fillState.status === "filling" && t("dashboard.fillingFields")}
          {fillState.status === "success" && t("history.fieldsFilled", { filled: fillState.filled, total: fillState.total })}
          {fillState.status === "error" && fillState.message}
        </span>
        <div className="jl-action-body">
          {fillState.status === "idle" && (
            <>
              <div className="jl-state-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4-5.7-1.8L10.2 9 12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="m18.5 3 .6 1.9L21 5.5l-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z" fill="currentColor" />
                </svg>
              </div>
              <div className="jl-action-copy">
                <h2>{t("dashboard.readyTitle")}</h2>
                <p>{t("dashboard.readyDesc")}</p>
              </div>
              <button type="button" onClick={handleFillNow} className="jl-btn jl-btn--primary">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 12l3-8h6l3 8M4.5 8h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t("dashboard.fillNow")}
              </button>
            </>
          )}

          {fillState.status === "filling" && (
            <>
              <div className="jl-state-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spinnerSvg(20) }} />
              <div className="jl-action-copy">
                <h2>{t("dashboard.fillingFields")}</h2>
                <p>{t("dashboard.fillingDesc")}</p>
              </div>
              <div className="jl-progress" aria-hidden="true">
                <div className="jl-progress-bar jl-progress-bar--indeterminate" />
              </div>
            </>
          )}

          {fillState.status === "success" && (
            <>
              <div className="jl-state-icon jl-state-icon--success" aria-hidden="true" dangerouslySetInnerHTML={{ __html: checkmarkSvg(20) }} />
              <div className="jl-action-copy">
                <h2>{t("dashboard.successTitle")}</h2>
                <p>{t("history.fieldsFilled", { filled: fillState.filled, total: fillState.total })}</p>
              </div>
              <div className="jl-result-chips" aria-label={t("dashboard.fillSources")}>
                {fillState.total > fillState.filled && (
                  <span className="jl-badge jl-badge--warning">
                    {t("dashboard.fieldsSkipped", { count: fillState.total - fillState.filled })}
                  </span>
                )}
                {fillState.sources?.profile ? (
                  <span className="jl-badge jl-badge--success">{t("dashboard.fromProfile", { count: fillState.sources.profile })}</span>
                ) : null}
                {fillState.sources?.historical ? (
                  <span className="jl-badge jl-badge--info">{t("dashboard.fromHistory", { count: fillState.sources.historical })}</span>
                ) : null}
              </div>
              <div className="jl-action-buttons">
                <button type="button" onClick={() => window.close()} className="jl-btn jl-btn--primary">
                  {t("dashboard.reviewOnPage")}
                </button>
                <button type="button" onClick={handleFillNow} className="jl-btn jl-btn--quiet">
                  {t("dashboard.fillAgain")}
                </button>
              </div>
            </>
          )}

          {fillState.status === "error" && (
            <>
              <div className="jl-state-icon jl-state-icon--error" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 8v4m0 4h.01M4.9 19h14.2a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.17 16A2 2 0 0 0 4.9 19Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
              </div>
              <div className="jl-action-copy">
                <h2>{t("dashboard.errorTitle")}</h2>
                <p>{fillState.message}</p>
              </div>
              <button type="button" onClick={handleFillNow} className="jl-btn jl-btn--primary">
                {t("dashboard.tryAgain")}
              </button>
            </>
          )}
        </div>

        <div className="jl-action-shortcut">
          <span>{t("dashboard.shortcutHint")}</span>
          <kbd>Alt</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>F</kbd>
        </div>
      </section>

      <button type="button" onClick={handleToggleWidget} className="jl-page-tool">
        <span className="jl-page-tool-icon" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="11" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
        <span>
          <strong>{t("dashboard.widgetTitle")}</strong>
          <small>{t("dashboard.widgetDesc")}</small>
        </span>
        <svg className="jl-page-tool-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {recentSubs.length > 0 && (
        <section className="jl-history" aria-labelledby="jl-history-title">
          <div className="jl-section-heading">
            <h2 id="jl-history-title">{t("history.title")}</h2>
            <span>{t("history.recent")}</span>
          </div>
          <div className="jl-history-list">
            {recentSubs.slice(0, 3).map((sub) => {
              const ratio = sub.fieldCount > 0 ? Math.round((sub.filledCount / sub.fieldCount) * 100) : 0;
              const seconds = Math.floor((renderedAt - new Date(sub.createdAt).getTime()) / 1000);
              const timeAgo = seconds < 60 ? t("history.justNow")
                : seconds < 3600 ? `${Math.floor(seconds / 60)}m`
                : seconds < 86400 ? `${Math.floor(seconds / 3600)}h`
                : `${Math.floor(seconds / 86400)}d`;
              return (
                <div key={sub.id} className="jl-history-row">
                  <div className="jl-history-domain" title={sub.pageDomain}>{sub.pageDomain}</div>
                  <span className="jl-history-provider">{sub.atsProvider || t("history.form")}</span>
                  <span className={`jl-history-score jl-history-score--${ratio >= 80 ? "high" : ratio >= 50 ? "medium" : "low"}`}>
                    {sub.filledCount}/{sub.fieldCount}
                  </span>
                  <time dateTime={sub.createdAt}>{timeAgo}</time>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
