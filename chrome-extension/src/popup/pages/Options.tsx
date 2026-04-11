import { useState, useEffect, useCallback } from "react";
import { STORAGE_KEYS, DEFAULT_API_BASE } from "@ext/shared/constants";
import { t } from "@ext/shared/i18n";
import { checkmarkSvg } from "@ext/shared/logo";

interface Preferences {
  autoFill: boolean;
  showWidget: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  autoFill: false,
  showWidget: true,
};

export function Options() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(
      [STORAGE_KEYS.API_BASE, STORAGE_KEYS.PREFERENCES],
      (result) => {
        if (result[STORAGE_KEYS.API_BASE]) {
          setApiBase(result[STORAGE_KEYS.API_BASE]);
        }
        if (result[STORAGE_KEYS.PREFERENCES]) {
          setPrefs({ ...DEFAULT_PREFERENCES, ...result[STORAGE_KEYS.PREFERENCES] });
        }
      },
    );
  }, []);

  const handleSave = useCallback(() => {
    chrome.storage.local.set({
      [STORAGE_KEYS.API_BASE]: apiBase.trim() || DEFAULT_API_BASE,
      [STORAGE_KEYS.PREFERENCES]: prefs,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [apiBase, prefs]);

  const togglePref = useCallback(
    (key: keyof Preferences) => {
      setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    [],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* API Base */}
      <div>
        <div className="jl-section-label">{t("options.apiBase")}</div>
        <div className="jl-input-group" style={{ marginBottom: 0 }}>
          <input
            type="url"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder={DEFAULT_API_BASE}
            className="jl-input"
            style={{ fontSize: 12, height: 36 }}
          />
          <div className="jl-input-hint">{t("options.apiBaseDesc")}</div>
        </div>
      </div>

      {/* Behavior toggles */}
      <div>
        <div className="jl-section-label">{t("options.behavior")}</div>
        <div className="jl-card" style={{ padding: "4px 14px" }}>
          <ToggleRow
            label={t("options.showWidget")}
            description="Shows floating widget on supported ATS pages"
            checked={prefs.showWidget}
            onChange={() => togglePref("showWidget")}
          />
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        className={`jl-btn ${saved ? "jl-btn--outline" : "jl-btn--primary"}`}
        style={saved ? {
          width: "100%",
          borderColor: "var(--jl-emerald-200)",
          color: "var(--jl-emerald-700)",
          background: "var(--jl-emerald-50)",
        } : { width: "100%" }}
      >
        {saved ? (
          <>
            <span dangerouslySetInnerHTML={{ __html: checkmarkSvg(14) }} />
            {t("options.saved")}
          </>
        ) : (
          t("options.save")
        )}
      </button>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="jl-toggle-row">
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11, color: "var(--jl-text-muted)", marginTop: 1 }}>
            {description}
          </div>
        )}
      </div>
      <div className="jl-toggle">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <div className="jl-toggle-track" />
        <div className="jl-toggle-thumb" />
      </div>
    </label>
  );
}
