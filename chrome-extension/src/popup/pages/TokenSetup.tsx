import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { STORAGE_KEYS, DEFAULT_API_BASE } from "@ext/shared/constants";
import {
  ApiBaseValidationError,
  normalizeApiBase,
  releaseApiBasePermission,
  requestApiBasePermission,
  resolveStoredApiBase,
} from "@ext/shared/apiBase";
import { t } from "@ext/shared/i18n";
import { checkmarkSvg, errorIconSvg, keyIconSvg, spinnerSvg } from "@ext/shared/logo";

interface TokenSetupProps {
  onConnected: () => void;
}

type Step = "input" | "verifying" | "success";

export function TokenSetup({ onConnected }: TokenSetupProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [apiBaseError, setApiBaseError] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [busy, setBusy] = useState(false);
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.API_BASE, (result) => {
      if (result[STORAGE_KEYS.API_BASE]) {
        setApiBase(resolveStoredApiBase(result[STORAGE_KEYS.API_BASE]));
      }
    });
    return () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    };
  }, []);

  const handleConnect = useCallback(async () => {
    if (busy) return;
    const trimmed = token.trim();
    if (!trimmed) {
      setError(t("auth.tokenEmpty"));
      return;
    }
    if (!trimmed.startsWith("jfext_")) {
      setError(t("auth.tokenInvalid"));
      return;
    }
    setError("");

    let baseToUse: string;
    try {
      baseToUse = normalizeApiBase(apiBase);
    } catch (err) {
      setShowAdvanced(true);
      setApiBaseError(
        err instanceof ApiBaseValidationError
          ? t("error.apiBaseInvalid")
          : t("error.unknown"),
      );
      return;
    }

    setBusy(true);
    setApiBaseError("");
    try {
      const permissionGranted = await requestApiBasePermission(baseToUse);
      if (!permissionGranted) {
        setShowAdvanced(true);
        setApiBaseError(t("error.apiBasePermissionDenied"));
        setBusy(false);
        return;
      }

      const stored = await chrome.storage.local.get(STORAGE_KEYS.API_BASE);
      const previousBase = resolveStoredApiBase(stored[STORAGE_KEYS.API_BASE]);
      await chrome.storage.local.set({ [STORAGE_KEYS.API_BASE]: baseToUse });
      try {
        await releaseApiBasePermission(previousBase, baseToUse);
      } catch {
        // The active origin is already safe; stale permission cleanup can retry later.
      }
    } catch {
      setShowAdvanced(true);
      setApiBaseError(t("auth.networkError", { base: baseToUse }));
      setBusy(false);
      return;
    }

    setStep("verifying");
    chrome.runtime.sendMessage(
      { type: "SET_TOKEN", token: trimmed },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          setStep("input");
          setBusy(false);
          setError(t("error.unknown"));
          return;
        }

        chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (profileResponse) => {
          if (!chrome.runtime.lastError && profileResponse?.success) {
            setStep("success");
            setBusy(false);
            transitionTimer.current = setTimeout(onConnected, 900);
            return;
          }

          setStep("input");
          setBusy(false);
          const serverError = profileResponse?.error ?? "";
          setError(
            serverError.includes("fetch") ||
            serverError.includes("network") ||
            serverError.includes("Failed")
              ? t("auth.networkError", { base: baseToUse })
              : t("auth.tokenInvalid"),
          );
          chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" });
        });
      },
    );
  }, [apiBase, busy, onConnected, token]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleConnect();
  }, [handleConnect]);

  if (step === "success") {
    return (
      <div className="jl-connection-state" role="status" aria-live="polite">
        <div className="jl-state-icon jl-state-icon--success jl-state-icon--large" aria-hidden="true" dangerouslySetInnerHTML={{ __html: checkmarkSvg(26) }} />
        <h2>{t("auth.connectedTitle")}</h2>
        <p>{t("auth.connectedDesc")}</p>
      </div>
    );
  }

  if (step === "verifying") {
    return (
      <div className="jl-connection-state" role="status" aria-live="polite" aria-busy="true">
        <div className="jl-state-icon jl-state-icon--large" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spinnerSvg(24) }} />
        <h2>{t("auth.connecting")}</h2>
        <p>{t("auth.verifying")}</p>
        <div className="jl-progress" aria-hidden="true">
          <div className="jl-progress-bar jl-progress-bar--indeterminate" />
        </div>
      </div>
    );
  }

  return (
    <form className="jl-connect-form" onSubmit={handleSubmit} noValidate>
      <div className="jl-connect-intro">
        <div className="jl-state-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M8.5 11.5 11 14l5-5m3 3a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <h1>{t("auth.connect")}</h1>
          <p>{t("auth.connectDesc")}</p>
        </div>
      </div>

      <div className="jl-input-group">
        <label className="jl-input-label" htmlFor="joblit-token">{t("auth.tokenLabel")}</label>
        <div className="jl-input-wrapper">
          <span className="jl-input-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: keyIconSvg(15) }} />
          <input
            id="joblit-token"
            type="password"
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              setError("");
            }}
            placeholder={t("auth.tokenPlaceholder")}
            className={`jl-input jl-input--has-icon ${error ? "jl-input--error" : ""}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={`joblit-token-hint${error ? " joblit-token-error" : ""}`}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div id="joblit-token-hint" className="jl-input-hint">{t("auth.tokenHint")}</div>
      </div>

      {error && (
        <div id="joblit-token-error" className="jl-error-msg" role="alert">
          <span className="jl-error-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: errorIconSvg(15) }} />
          <span>{error}</span>
        </div>
      )}

      <button type="submit" className="jl-btn jl-btn--primary" disabled={busy} aria-busy={busy}>
        {busy && <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: spinnerSvg(15) }} />}
        {busy ? t("auth.connecting") : t("auth.connect")}
      </button>

      <button
        type="button"
        className="jl-collapse-toggle"
        aria-expanded={showAdvanced}
        aria-controls="joblit-advanced-settings"
        onClick={() => setShowAdvanced((visible) => !visible)}
      >
        <svg className="jl-collapse-arrow" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>{t("auth.advanced")}</span>
      </button>

      {showAdvanced && (
        <div id="joblit-advanced-settings" className="jl-advanced-panel">
          <div className="jl-input-group">
            <label className="jl-input-label" htmlFor="joblit-connect-api-base">{t("options.apiBase")}</label>
            <input
              id="joblit-connect-api-base"
              type="url"
              value={apiBase}
              onChange={(event) => {
                setApiBase(event.target.value);
                setApiBaseError("");
              }}
              placeholder={DEFAULT_API_BASE}
              className={`jl-input ${apiBaseError ? "jl-input--error" : ""}`}
              aria-invalid={apiBaseError ? true : undefined}
              aria-describedby={`joblit-connect-api-hint${apiBaseError ? " joblit-connect-api-error" : ""}`}
            />
            <div id="joblit-connect-api-hint" className="jl-input-hint">{t("auth.apiBaseHint")}</div>
            {apiBaseError && (
              <div id="joblit-connect-api-error" className="jl-error-msg" role="alert">
                <span className="jl-error-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: errorIconSvg(15) }} />
                <span>{apiBaseError}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="jl-connect-help">{t("auth.setupHint")}</p>
    </form>
  );
}
