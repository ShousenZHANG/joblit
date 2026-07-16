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
import {
  DEFAULT_HERMES_BASE,
  DEFAULT_HERMES_PROFILE_NAME,
  HermesBaseValidationError,
  isHermesProfileName,
  normalizeHermesBase,
  requestHermesBasePermission,
} from "@ext/shared/hermesBase";
import type { HermesSettingsPublic } from "@ext/shared/hermesTypes";
import { sendMessage } from "@ext/shared/messaging";

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

type HermesUiState =
  | "not_configured"
  | "checking"
  | "unavailable"
  | "auth_failed"
  | "incompatible"
  | "ready";

function hermesStateFromError(code?: string): HermesUiState {
  if (code === "HERMES_AUTH_FAILED") return "auth_failed";
  if (code === "HERMES_INCOMPATIBLE" || code === "HERMES_PROTOCOL_ERROR") return "incompatible";
  return "unavailable";
}

function hermesErrorKey(code?: string): string {
  switch (code) {
    case "HERMES_AUTH_FAILED":
    case "HERMES_INCOMPATIBLE":
    case "HERMES_PROTOCOL_ERROR":
    case "HERMES_UNREACHABLE":
    case "HERMES_RATE_LIMITED":
    case "HERMES_RESPONSE_TOO_LARGE":
    case "HERMES_NOT_CONFIGURED":
      return `localAi.error.${code}`;
    default:
      return "localAi.error.unknown";
  }
}

export function Options({ onDisconnect }: OptionsProps) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [apiBaseError, setApiBaseError] = useState("");
  const [showConnection, setShowConnection] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  const [hermesBase, setHermesBase] = useState(DEFAULT_HERMES_BASE);
  const [hermesProfile, setHermesProfile] = useState(DEFAULT_HERMES_PROFILE_NAME);
  const [hermesKey, setHermesKey] = useState("");
  const [hermesHasKey, setHermesHasKey] = useState(false);
  const [hermesState, setHermesState] = useState<HermesUiState>("checking");
  const [hermesBusy, setHermesBusy] = useState(false);
  const [hermesError, setHermesError] = useState("");
  const [showHermesConfig, setShowHermesConfig] = useState(false);

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

  const checkSavedHermes = useCallback(async () => {
    setHermesState("checking");
    const response = await sendMessage<HermesSettingsPublic>({ type: "CHECK_HERMES_SETTINGS" }, 30_000);
    if (response?.success) {
      setHermesState("ready");
      return;
    }
    setHermesState(hermesStateFromError(response.errorCode));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sendMessage<HermesSettingsPublic>({ type: "GET_HERMES_SETTINGS" }).then((response) => {
      if (cancelled) return;
      if (!response?.success || !response.data) {
        setHermesState("not_configured");
        return;
      }
      setHermesBase(response.data.baseUrl);
      setHermesProfile(response.data.profileName);
      setHermesHasKey(response.data.hasApiKey);
      if (!response.data.configured) {
        setHermesState("not_configured");
        return;
      }
      void checkSavedHermes();
    });
    return () => { cancelled = true; };
  }, [checkSavedHermes]);

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

  const handleHermesSave = useCallback(async () => {
    if (hermesBusy) return;
    setHermesError("");
    let baseUrl: string;
    try {
      baseUrl = normalizeHermesBase(hermesBase);
    } catch (error) {
      setHermesError(error instanceof HermesBaseValidationError ? t("localAi.endpointInvalid") : t("error.unknown"));
      setShowHermesConfig(true);
      return;
    }
    if (!isHermesProfileName(hermesProfile)) {
      setHermesError(t("localAi.profileInvalid"));
      return;
    }
    if (!hermesHasKey && !hermesKey.trim()) {
      setHermesError(t("localAi.keyRequired"));
      return;
    }

    setHermesBusy(true);
    setHermesState("checking");
    try {
      const allowed = await requestHermesBasePermission(baseUrl);
      if (!allowed) {
        setHermesState("not_configured");
        setHermesError(t("localAi.permissionDenied"));
        return;
      }
      const response = await sendMessage<HermesSettingsPublic>(
        {
          type: "TEST_AND_SAVE_HERMES_SETTINGS",
          data: {
            baseUrl,
            profileName: hermesProfile,
            ...(hermesKey.trim() ? { apiKey: hermesKey.trim() } : {}),
          },
        },
        30_000,
      );
      if (!response?.success) {
        setHermesState(hermesStateFromError(response.errorCode));
        setHermesError(t(hermesErrorKey(response.errorCode)));
        return;
      }
      setHermesBase(baseUrl);
      setHermesHasKey(true);
      setHermesKey("");
      setHermesState("ready");
    } catch {
      setHermesState("unavailable");
      setHermesError(t("localAi.error.unknown"));
    } finally {
      setHermesBusy(false);
    }
  }, [hermesBase, hermesBusy, hermesHasKey, hermesKey, hermesProfile]);

  const handleForgetHermes = useCallback(async () => {
    if (hermesBusy) return;
    setHermesBusy(true);
    const response = await sendMessage({ type: "CLEAR_HERMES_SETTINGS" });
    setHermesBusy(false);
    if (!response?.success) {
      setHermesError(t("localAi.error.unknown"));
      return;
    }
    setHermesBase(DEFAULT_HERMES_BASE);
    setHermesProfile(DEFAULT_HERMES_PROFILE_NAME);
    setHermesKey("");
    setHermesHasKey(false);
    setHermesState("not_configured");
    setHermesError("");
  }, [hermesBusy]);

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

      <section className="jl-settings-card jl-local-ai" aria-labelledby="jl-local-ai-title">
        <div className="jl-local-ai-heading">
          <div>
            <div className="jl-local-ai-title-row">
              <h2 id="jl-local-ai-title">{t("localAi.title")}</h2>
              <span className="jl-badge jl-badge--info">{t("localAi.beta")}</span>
            </div>
            <p>{t("localAi.description")}</p>
          </div>
          <span className={`jl-local-ai-status jl-local-ai-status--${hermesState}`} aria-live="polite">
            {hermesState === "checking" && <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: spinnerSvg(13) }} />}
            {t(`localAi.state.${hermesState}`)}
          </span>
        </div>

        <button
          type="button"
          className="jl-disclosure jl-disclosure--compact"
          aria-expanded={showHermesConfig}
          aria-controls="jl-hermes-settings"
          onClick={() => setShowHermesConfig((open) => !open)}
        >
          <span><strong>{t("localAi.configure")}</strong><small>{t("localAi.configureDesc")}</small></span>
          <svg className="jl-disclosure-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m5 6 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {showHermesConfig && (
          <div id="jl-hermes-settings" className="jl-local-ai-form">
            <div className="jl-input-group">
              <label className="jl-input-label" htmlFor="hermes-endpoint">{t("localAi.endpoint")}</label>
              <input id="hermes-endpoint" className="jl-input" type="url" value={hermesBase} onChange={(event) => setHermesBase(event.target.value)} />
            </div>
            <div className="jl-input-group">
              <label className="jl-input-label" htmlFor="hermes-profile">{t("localAi.profile")}</label>
              <input id="hermes-profile" className="jl-input" value={hermesProfile} onChange={(event) => setHermesProfile(event.target.value)} placeholder="joblit-0123456789abcdef" autoComplete="off" />
            </div>
            <div className="jl-input-group">
              <label className="jl-input-label" htmlFor="hermes-api-key">{t("localAi.apiKey")}</label>
              <input
                id="hermes-api-key"
                className="jl-input"
                type="password"
                value={hermesKey}
                onChange={(event) => setHermesKey(event.target.value)}
                placeholder={hermesHasKey ? t("localAi.keySaved") : t("localAi.keyPlaceholder")}
                autoComplete="new-password"
              />
              <div className="jl-input-hint">{t("localAi.keyHint")}</div>
            </div>
            {hermesError && <div className="jl-error-msg" role="alert">{hermesError}</div>}
            <div className="jl-local-ai-actions">
              <button type="button" className="jl-btn jl-btn--primary" onClick={() => void handleHermesSave()} disabled={hermesBusy} aria-busy={hermesBusy}>
                {hermesBusy && <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: spinnerSvg(15) }} />}
                {t("localAi.testSave")}
              </button>
              {hermesHasKey && (
                <button type="button" className="jl-btn jl-btn--quiet" onClick={() => void handleForgetHermes()} disabled={hermesBusy}>
                  {t("localAi.forget")}
                </button>
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
