import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS, DEFAULT_API_BASE } from "@ext/shared/constants";
import {
  ApiBaseValidationError,
  normalizeApiBase,
  releaseApiBasePermission,
  requestApiBasePermission,
  resolveStoredApiBase,
} from "@ext/shared/apiBase";
import { t } from "@ext/shared/i18n";
import { checkmarkSvg, spinnerSvg } from "@ext/shared/logo";

interface Preferences {
  autoFill: boolean;
  showWidget: boolean;
}

interface OptionsProps {
  onDisconnect: () => void;
}

const DEFAULT_PREFERENCES: Preferences = {
  autoFill: false,
  showWidget: true,
};

export function Options({ onDisconnect }: OptionsProps) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [apiBaseError, setApiBaseError] = useState("");
  const [showConnection, setShowConnection] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");

  useEffect(() => {
    chrome.storage.local.get(
      [STORAGE_KEYS.API_BASE, STORAGE_KEYS.PREFERENCES],
      (result) => {
        if (result[STORAGE_KEYS.API_BASE]) {
          setApiBase(resolveStoredApiBase(result[STORAGE_KEYS.API_BASE]));
        }
        if (result[STORAGE_KEYS.PREFERENCES]) {
          setPrefs({ ...DEFAULT_PREFERENCES, ...result[STORAGE_KEYS.PREFERENCES] });
        }
      },
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (saveState === "saving") return;
    setSaveState("saving");
    setApiBaseError("");

    let normalizedBase: string;
    try {
      normalizedBase = normalizeApiBase(apiBase);
    } catch (err) {
      setShowConnection(true);
      setApiBaseError(
        err instanceof ApiBaseValidationError
          ? t("error.apiBaseInvalid")
          : t("error.unknown"),
      );
      setSaveState("idle");
      return;
    }

    try {
      const permissionGranted = await requestApiBasePermission(normalizedBase);
      if (!permissionGranted) {
        setShowConnection(true);
        setApiBaseError(t("error.apiBasePermissionDenied"));
        setSaveState("idle");
        return;
      }

      const stored = await chrome.storage.local.get(STORAGE_KEYS.API_BASE);
      const previousBase = resolveStoredApiBase(stored[STORAGE_KEYS.API_BASE]);

      await chrome.storage.local.set({
        [STORAGE_KEYS.API_BASE]: normalizedBase,
        [STORAGE_KEYS.PREFERENCES]: prefs,
      });
      try {
        await releaseApiBasePermission(previousBase, normalizedBase);
      } catch {
        // The active origin is already safe; stale permission cleanup can retry later.
      }
      setApiBase(normalizedBase);
      setSaveState("saved");
    } catch {
      setApiBaseError(t("error.settingsSave"));
      setShowConnection(true);
      setSaveState("idle");
    }
  }, [apiBase, prefs, saveState]);

  const toggleWidget = useCallback(() => {
    setPrefs((previous) => ({ ...previous, showWidget: !previous.showWidget }));
    setSaveState("idle");
  }, []);

  const handleDisconnect = useCallback(() => {
    if (disconnecting) return;
    setDisconnecting(true);
    setDisconnectError("");
    chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" }, (response) => {
      setDisconnecting(false);
      if (chrome.runtime.lastError || response?.success === false) {
        setDisconnectError(t("error.disconnectFailed"));
        return;
      }
      onDisconnect();
    });
  }, [disconnecting, onDisconnect]);

  return (
    <div className="jl-page-stack">
      <section aria-labelledby="jl-behavior-title">
        <div className="jl-section-heading jl-section-heading--stacked">
          <h2 id="jl-behavior-title">{t("options.behavior")}</h2>
          <p>{t("options.behaviorDesc")}</p>
        </div>
        <div className="jl-settings-card">
          <ToggleRow
            label={t("options.showWidget")}
            description={t("options.showWidgetDesc")}
            checked={prefs.showWidget}
            onChange={toggleWidget}
          />
        </div>
      </section>

      <section className="jl-settings-card jl-settings-card--connection">
        <button
          type="button"
          className="jl-disclosure"
          aria-expanded={showConnection}
          aria-controls="jl-connection-settings"
          onClick={() => setShowConnection((open) => !open)}
        >
          <span className="jl-disclosure-icon" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
              <path d="M6.5 2.5h3M5 5h6a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 8v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <span>
            <strong>{t("options.connection")}</strong>
            <small>{t("options.connectionDesc")}</small>
          </span>
          <svg className="jl-disclosure-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m5 6 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {showConnection && (
          <div id="jl-connection-settings" className="jl-disclosure-panel">
            <div className="jl-input-group">
              <label className="jl-input-label" htmlFor="joblit-api-base">{t("options.apiBase")}</label>
              <input
                id="joblit-api-base"
                type="url"
                value={apiBase}
                onChange={(event) => {
                  setApiBase(event.target.value);
                  setApiBaseError("");
                  setSaveState("idle");
                }}
                placeholder={DEFAULT_API_BASE}
                className={`jl-input ${apiBaseError ? "jl-input--error" : ""}`}
                aria-invalid={apiBaseError ? true : undefined}
                aria-describedby={`joblit-api-base-hint${apiBaseError ? " joblit-api-base-error" : ""}`}
              />
              <div id="joblit-api-base-hint" className="jl-input-hint">{t("options.apiBaseDesc")}</div>
              {apiBaseError && (
                <div id="joblit-api-base-error" className="jl-error-msg" role="alert">{apiBaseError}</div>
              )}
            </div>
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={handleSave}
        className={`jl-btn ${saveState === "saved" ? "jl-btn--success" : "jl-btn--primary"}`}
        disabled={saveState === "saving"}
        aria-busy={saveState === "saving"}
      >
        {saveState === "saving" && <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: spinnerSvg(15) }} />}
        {saveState === "saved" && <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: checkmarkSvg(15) }} />}
        {saveState === "saving" ? t("options.saving") : saveState === "saved" ? t("options.saved") : t("options.save")}
      </button>

      <section className="jl-account-section" aria-labelledby="jl-account-title">
        <div className="jl-section-heading jl-section-heading--stacked">
          <h2 id="jl-account-title">{t("options.account")}</h2>
          <p>{t("options.accountDesc")}</p>
        </div>

        {!confirmDisconnect ? (
          <button type="button" className="jl-btn jl-btn--danger-quiet" onClick={() => setConfirmDisconnect(true)}>
            {t("auth.disconnect")}
          </button>
        ) : (
          <div className="jl-confirm-panel" role="group" aria-label={t("auth.confirmDisconnect") }>
            <p>{t("auth.disconnectWarning")}</p>
            <div className="jl-confirm-actions">
              <button type="button" className="jl-btn jl-btn--outline" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting}>
                {t("common.cancel")}
              </button>
              <button type="button" className="jl-btn jl-btn--danger" onClick={handleDisconnect} disabled={disconnecting} aria-busy={disconnecting}>
                {disconnecting ? t("auth.disconnecting") : t("auth.disconnectAccount")}
              </button>
            </div>
          </div>
        )}
        {disconnectError && <div className="jl-error-msg" role="alert">{disconnectError}</div>}
      </section>
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
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="jl-toggle-row">
      <span className="jl-toggle-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="jl-toggle">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="jl-toggle-track" />
        <span className="jl-toggle-thumb" />
      </span>
    </label>
  );
}
