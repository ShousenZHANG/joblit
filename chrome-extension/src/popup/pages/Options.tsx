import { useState, useEffect, useCallback } from "react";
import { STORAGE_KEYS, DEFAULT_API_BASE } from "@ext/shared/constants";
import { t } from "@ext/shared/i18n";

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
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          {t("options.apiBase")}
        </div>
        <input
          type="url"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder={DEFAULT_API_BASE}
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
          {t("options.apiBaseDesc")}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          {t("options.behavior")}
        </div>
        <ToggleRow
          label={t("options.autoFill")}
          checked={prefs.autoFill}
          onChange={() => togglePref("autoFill")}
        />
        <ToggleRow
          label={t("options.showWidget")}
          checked={prefs.showWidget}
          onChange={() => togglePref("showWidget")}
        />
      </div>

      <button
        onClick={handleSave}
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
        }}
      >
        {saved ? t("options.saved") : t("options.save")}
      </button>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid #f0f0f0",
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ width: 16, height: 16, accentColor: "#2563eb" }}
      />
    </label>
  );
}
