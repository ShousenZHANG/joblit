import { useState, useEffect, useCallback } from "react";
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
  { value: "en-AU", label: "English (AU)" },
  { value: "zh-CN", label: "中文 (CN)" },
] as const;

export function ProfileSelect() {
  const [currentLocale, setCurrentLocale] = useState("en-AU");
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback((locale: string) => {
    setLoading(true);
    chrome.runtime.sendMessage(
      { type: "GET_FLAT_PROFILE", locale },
      (response) => {
        setLoading(false);
        if (response?.success && response.data) {
          setProfile(response.data);
        } else {
          setProfile(null);
        }
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

  const handleLocaleChange = useCallback(
    (locale: string) => {
      setCurrentLocale(locale);
      chrome.storage.local.set({ [STORAGE_KEYS.LOCALE]: locale });
      chrome.storage.local.remove(STORAGE_KEYS.CACHED_PROFILE);
      loadProfile(locale);
    },
    [loadProfile],
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          {t("profile.locale")}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {SUPPORTED_LOCALES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleLocaleChange(value)}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: currentLocale === value ? "#2563eb" : "#f1f5f9",
                color: currentLocale === value ? "#fff" : "#334155",
                border: currentLocale === value ? "none" : "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: currentLocale === value ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
          background: "#fafafa",
        }}
      >
        <div style={{ fontSize: 11, color: "#666", fontWeight: 600, marginBottom: 8 }}>
          {t("profile.active")}
        </div>

        {loading ? (
          <div style={{ color: "#888", fontSize: 13 }}>{t("app.loading")}</div>
        ) : profile ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {profile.flat?.fullName ?? "—"}
            </div>
            <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
              {profile.flat?.currentTitle ?? "—"}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              {profile.flat?.email ?? "—"} &middot; {profile.profileName}
            </div>
          </>
        ) : (
          <div style={{ color: "#888", fontSize: 13 }}>
            {t("profile.noProfile")}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 10,
          background: "#fef3c7",
          border: "1px solid #fde68a",
          borderRadius: 6,
          fontSize: 12,
          color: "#92400e",
        }}
      >
        {t("profile.manageHint")}
      </div>
    </div>
  );
}
