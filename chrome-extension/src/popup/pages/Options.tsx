import { useState, useEffect, useCallback } from "react";
import { STORAGE_KEYS, DEFAULT_API_BASE } from "@ext/shared/constants";

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
          API Base URL
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
          Change only if using a self-hosted Jobflow instance.
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Behavior
        </div>
        <ToggleRow
          label="Auto-fill on page load"
          checked={prefs.autoFill}
          onChange={() => togglePref("autoFill")}
        />
        <ToggleRow
          label="Show floating widget"
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
        {saved ? "Saved!" : "Save Settings"}
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
