import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { STORAGE_KEYS } from "@ext/shared/constants";
import { t } from "@ext/shared/i18n";

interface ProfileInfo {
  profileName: string;
  locale: string;
  flat?: {
    fullName?: string;
    email?: string;
    currentTitle?: string;
  };
}

const SUPPORTED_LOCALES = [
  { value: "en-AU", label: "English (AU)", short: "AU" },
  { value: "zh-CN", label: "中文 (CN)", short: "CN" },
] as const;

export function ProfileSelect() {
  const [currentLocale, setCurrentLocale] = useState("en-AU");
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const localeRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const loadProfile = useCallback((locale: string) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError("");
    chrome.runtime.sendMessage(
      { type: "GET_FLAT_PROFILE", locale },
      (response) => {
        if (requestId !== requestSequence.current) return;
        setLoading(false);
        if (chrome.runtime.lastError) {
          setProfile(null);
          setError(t("error.profileLoad"));
          return;
        }
        if (response?.success && response.data) {
          setProfile(response.data);
          return;
        }
        setProfile(null);
        if (response?.error) setError(response.error);
      },
    );
  }, []);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.LOCALE, (result) => {
      const savedLocale = result[STORAGE_KEYS.LOCALE] ?? "en-AU";
      setCurrentLocale(savedLocale);
      loadProfile(savedLocale);
    });
  }, [loadProfile]);

  const handleLocaleChange = useCallback((locale: string) => {
    if (locale === currentLocale) return;
    setCurrentLocale(locale);
    void chrome.storage.local.set({ [STORAGE_KEYS.LOCALE]: locale });
    void chrome.storage.local.remove(STORAGE_KEYS.CACHED_PROFILE);
    loadProfile(locale);
  }, [currentLocale, loadProfile]);

  const handleLocaleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, locale: string) => {
    const locales = SUPPORTED_LOCALES.map((item) => item.value);
    const currentIndex = locales.indexOf(locale as (typeof locales)[number]);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % locales.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + locales.length) % locales.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = locales.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextLocale = locales[nextIndex];
    handleLocaleChange(nextLocale);
    localeRefs.current[nextLocale]?.focus();
  }, [handleLocaleChange]);

  return (
    <div className="jl-page-stack">
      <section aria-labelledby="jl-locale-title">
        <div className="jl-section-heading jl-section-heading--stacked">
          <h2 id="jl-locale-title">{t("profile.locale")}</h2>
          <p>{t("profile.localeDesc")}</p>
        </div>
        <div className="jl-segmented" role="radiogroup" aria-labelledby="jl-locale-title">
          {SUPPORTED_LOCALES.map(({ value, label, short }) => {
            const active = currentLocale === value;
            return (
              <button
                key={value}
                ref={(element) => { localeRefs.current[value] = element; }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => handleLocaleChange(value)}
                onKeyDown={(event) => handleLocaleKeyDown(event, value)}
                className={`jl-segmented-option ${active ? "jl-segmented-option--active" : ""}`}
              >
                <span className="jl-locale-code" aria-hidden="true">{short}</span>
                <span>{label}</span>
                {active && (
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="jl-profile-card" aria-labelledby="jl-active-profile-title" aria-busy={loading}>
        <div className="jl-profile-card-header">
          <div>
            <span className="jl-eyebrow">{t("profile.active")}</span>
            <h2 id="jl-active-profile-title">{profile?.profileName || t("profile.profileTitle")}</h2>
          </div>
          {!loading && profile && <span className="jl-badge jl-badge--success">{t("profile.ready")}</span>}
        </div>

        {loading ? (
          <div className="jl-profile-detail jl-profile-detail--loading" role="status">
            <div className="jl-skeleton jl-skeleton--avatar" />
            <div className="jl-skeleton-stack">
              <div className="jl-skeleton" style={{ width: 120, height: 14 }} />
              <div className="jl-skeleton" style={{ width: 170, height: 11 }} />
              <div className="jl-skeleton" style={{ width: 145, height: 11 }} />
            </div>
          </div>
        ) : error ? (
          <div className="jl-empty-state" role="alert">
            <div className="jl-state-icon jl-state-icon--error" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 8v4m0 4h.01M4.9 19h14.2a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.17 16A2 2 0 0 0 4.9 19Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            </div>
            <strong>{t("profile.loadFailed")}</strong>
            <p>{error}</p>
            <button type="button" className="jl-btn jl-btn--outline" onClick={() => loadProfile(currentLocale)}>{t("app.retry")}</button>
          </div>
        ) : profile ? (
          <div className="jl-profile-detail">
            <div className="jl-avatar jl-avatar--large" aria-hidden="true">
              {(profile.flat?.fullName ?? "?")[0].toUpperCase()}
            </div>
            <div className="jl-profile-copy">
              <div className="jl-profile-name">{profile.flat?.fullName ?? "—"}</div>
              <div className="jl-profile-role">{profile.flat?.currentTitle ?? t("profile.titleMissing")}</div>
              <div className="jl-profile-meta">{profile.flat?.email ?? t("profile.emailMissing")}</div>
            </div>
          </div>
        ) : (
          <div className="jl-empty-state">
            <div className="jl-state-icon jl-state-icon--neutral" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="9" r="4" stroke="currentColor" strokeWidth="1.6" />
                <path d="M4.5 20c0-4.2 3.3-7 7.5-7s7.5 2.8 7.5 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <strong>{t("profile.emptyTitle")}</strong>
            <p>{t("profile.noProfile")}</p>
          </div>
        )}
      </section>

      <div className="jl-info-note">
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.2v3.5M8 4.8v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>{t("profile.manageHint")}</span>
      </div>
    </div>
  );
}
