import { useState, useEffect, useCallback } from "react";
import { STORAGE_KEYS, DEFAULT_API_BASE } from "@ext/shared/constants";
import { t } from "@ext/shared/i18n";
import { checkmarkSvg } from "@ext/shared/logo";

interface Preferences {
  autoFill: boolean;
  showWidget: boolean;
}

interface DefaultAnswers {
  workAuthorization: string;
  sponsorshipRequired: string;
  yearsExperience: string;
  desiredSalary: string;
}

const DEFAULT_PREFERENCES: Preferences = {
  autoFill: false,
  showWidget: true,
};

const DEFAULT_ANSWERS_INIT: DefaultAnswers = {
  workAuthorization: "Yes",
  sponsorshipRequired: "No",
  yearsExperience: "",
  desiredSalary: "",
};

export function Options() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [answers, setAnswers] = useState<DefaultAnswers>(DEFAULT_ANSWERS_INIT);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(
      [STORAGE_KEYS.API_BASE, STORAGE_KEYS.PREFERENCES, STORAGE_KEYS.DEFAULT_ANSWERS],
      (result) => {
        if (result[STORAGE_KEYS.API_BASE]) {
          setApiBase(result[STORAGE_KEYS.API_BASE]);
        }
        if (result[STORAGE_KEYS.PREFERENCES]) {
          setPrefs({ ...DEFAULT_PREFERENCES, ...result[STORAGE_KEYS.PREFERENCES] });
        }
        if (result[STORAGE_KEYS.DEFAULT_ANSWERS]) {
          setAnswers({ ...DEFAULT_ANSWERS_INIT, ...result[STORAGE_KEYS.DEFAULT_ANSWERS] });
        }
      },
    );
  }, []);

  const handleSave = useCallback(() => {
    chrome.storage.local.set({
      [STORAGE_KEYS.API_BASE]: apiBase.trim() || DEFAULT_API_BASE,
      [STORAGE_KEYS.PREFERENCES]: prefs,
      [STORAGE_KEYS.DEFAULT_ANSWERS]: answers,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [apiBase, prefs, answers]);

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
            label={t("options.autoFill")}
            description="Automatically fills detected forms when page loads"
            checked={prefs.autoFill}
            onChange={() => togglePref("autoFill")}
          />
          <ToggleRow
            label={t("options.showWidget")}
            description="Shows floating widget on supported ATS pages"
            checked={prefs.showWidget}
            onChange={() => togglePref("showWidget")}
          />
        </div>
      </div>

      {/* Default Answers */}
      <div>
        <div className="jl-section-label">Default Answers</div>
        <div className="jl-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
              Authorized to work?
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {["Yes", "No"].map((v) => (
                <button
                  key={v}
                  onClick={() => setAnswers((p) => ({ ...p, workAuthorization: v }))}
                  className={`jl-btn ${answers.workAuthorization === v ? "jl-btn--primary" : "jl-btn--outline"}`}
                  style={{ flex: 1, height: 32, fontSize: 12 }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
              Require visa sponsorship?
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {["Yes", "No"].map((v) => (
                <button
                  key={v}
                  onClick={() => setAnswers((p) => ({ ...p, sponsorshipRequired: v }))}
                  className={`jl-btn ${answers.sponsorshipRequired === v ? "jl-btn--primary" : "jl-btn--outline"}`}
                  style={{ flex: 1, height: 32, fontSize: 12 }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
              Years of experience
            </div>
            <input
              type="text"
              value={answers.yearsExperience}
              onChange={(e) => setAnswers((p) => ({ ...p, yearsExperience: e.target.value }))}
              placeholder="e.g. 3"
              className="jl-input"
              style={{ fontSize: 12, height: 32 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
              Desired salary (optional)
            </div>
            <input
              type="text"
              value={answers.desiredSalary}
              onChange={(e) => setAnswers((p) => ({ ...p, desiredSalary: e.target.value }))}
              placeholder="e.g. 120000"
              className="jl-input"
              style={{ fontSize: 12, height: 32 }}
            />
          </div>
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
