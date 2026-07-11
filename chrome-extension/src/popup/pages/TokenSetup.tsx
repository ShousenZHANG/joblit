import { useState, useEffect, useCallback } from "react";
import { STORAGE_KEYS, DEFAULT_API_BASE } from "@ext/shared/constants";
import {
  ApiBaseValidationError,
  normalizeApiBase,
  releaseApiBasePermission,
  requestApiBasePermission,
  resolveStoredApiBase,
} from "@ext/shared/apiBase";
import { t } from "@ext/shared/i18n";
import { checkmarkSvg, keyIconSvg, errorIconSvg } from "@ext/shared/logo";

interface TokenSetupProps {
  onConnected: () => void;
}

type Step = "input" | "verifying" | "success";

export function TokenSetup({ onConnected }: TokenSetupProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [apiBaseError, setApiBaseError] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.API_BASE, (result) => {
      if (result[STORAGE_KEYS.API_BASE]) {
        setApiBase(resolveStoredApiBase(result[STORAGE_KEYS.API_BASE]));
      }
    });
  }, []);

  const handleConnect = useCallback(async () => {
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

    let permissionGranted = false;
    try {
      permissionGranted = await requestApiBasePermission(baseToUse);
    } catch {
      permissionGranted = false;
    }
    if (!permissionGranted) {
      setShowAdvanced(true);
      setApiBaseError(t("error.apiBasePermissionDenied"));
      return;
    }
    setApiBaseError("");

    const stored = await chrome.storage.local.get(STORAGE_KEYS.API_BASE);
    const previousBase = resolveStoredApiBase(stored[STORAGE_KEYS.API_BASE]);

    // Persist only after validation and an exact-origin permission grant.
    await chrome.storage.local.set({ [STORAGE_KEYS.API_BASE]: baseToUse });
    try {
      await releaseApiBasePermission(previousBase, baseToUse);
    } catch {
      // The new origin is already active; stale permission cleanup can retry later.
    }

    setStep("verifying");
    setError("");

    chrome.runtime.sendMessage(
      { type: "SET_TOKEN", token: trimmed },
      (response) => {
        if (response?.success) {
          // Verify the token works by fetching profile
          chrome.runtime.sendMessage(
            { type: "GET_PROFILE" },
            (profileResponse) => {
              if (profileResponse?.success) {
                setStep("success");
                setTimeout(() => onConnected(), 1200);
              } else {
                setStep("input");
                const serverError = profileResponse?.error ?? "";
                if (
                  serverError.includes("fetch") ||
                  serverError.includes("network") ||
                  serverError.includes("Failed")
                ) {
                  setError(t("auth.networkError", { base: baseToUse }));
                } else {
                  setError(t("auth.tokenInvalid"));
                }
                chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" });
              }
            },
          );
        } else {
          setStep("input");
          setError(t("error.unknown"));
        }
      },
    );
  }, [token, apiBase, onConnected]);

  const stepIndex = step === "input" ? 0 : step === "verifying" ? 1 : 2;

  return (
    <div>
      {/* Step indicator */}
      <div className="jl-stepper">
        <div className={`jl-step-dot ${stepIndex >= 0 ? "jl-step-dot--active" : ""} ${stepIndex > 0 ? "jl-step-dot--done" : ""}`} />
        <div className={`jl-step-line ${stepIndex > 0 ? "jl-step-line--done" : ""}`} />
        <div className={`jl-step-dot ${stepIndex >= 1 ? "jl-step-dot--active" : ""} ${stepIndex > 1 ? "jl-step-dot--done" : ""}`} />
        <div className={`jl-step-line ${stepIndex > 1 ? "jl-step-line--done" : ""}`} />
        <div className={`jl-step-dot ${stepIndex >= 2 ? "jl-step-dot--active" : ""}`} />
      </div>

      {/* Success state */}
      {step === "success" && (
        <div className="jl-result">
          <div
            className="jl-success-check"
            dangerouslySetInnerHTML={{ __html: checkmarkSvg(28) }}
          />
          <div className="jl-result-title" style={{ color: "var(--jl-emerald-700)" }}>
            {t("auth.connected")}
          </div>
          <div className="jl-result-desc">Redirecting to dashboard...</div>
        </div>
      )}

      {/* Verifying state */}
      {step === "verifying" && (
        <div className="jl-result">
          <div className="jl-spinner" style={{ width: 36, height: 36 }} />
          <div className="jl-result-title">{t("auth.connecting")}</div>
          <div className="jl-result-desc">Verifying your token...</div>
        </div>
      )}

      {/* Input state */}
      {step === "input" && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: "var(--jl-text-primary)" }}>
            {t("auth.connect")}
          </h2>
          <p style={{ fontSize: 13, color: "var(--jl-text-muted)", marginBottom: 18, lineHeight: 1.5 }}>
            {t("auth.connectDesc")}
          </p>

          {/* Token input */}
          <div className="jl-input-group">
            <label className="jl-input-label">Token</label>
            <div className="jl-input-wrapper">
              <span
                className="jl-input-icon"
                dangerouslySetInnerHTML={{ __html: keyIconSvg(14) }}
              />
              <input
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) setError("");
                }}
                placeholder={t("auth.tokenPlaceholder")}
                className={`jl-input jl-input--has-icon ${error ? "jl-input--error" : ""}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnect();
                }}
                autoFocus
              />
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="jl-error-msg" style={{ marginBottom: 14 }}>
              <span
                className="jl-error-icon"
                dangerouslySetInnerHTML={{ __html: errorIconSvg(14) }}
              />
              <span>{error}</span>
            </div>
          )}

          {/* Connect button */}
          <button
            onClick={handleConnect}
            className="jl-btn jl-btn--primary"
          >
            {t("auth.connect")}
          </button>

          {/* Advanced: API Base URL */}
          <button
            className="jl-collapse-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <svg className="jl-collapse-arrow" viewBox="0 0 12 12" fill="none">
              <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Advanced Settings</span>
          </button>

          <div className={`jl-collapse-body ${showAdvanced ? "jl-collapse-body--open" : ""}`}>
            <div className="jl-input-group" style={{ marginTop: 4 }}>
              <label className="jl-input-label">{t("options.apiBase")}</label>
              <input
                type="url"
                value={apiBase}
                onChange={(e) => {
                  setApiBase(e.target.value);
                  if (apiBaseError) setApiBaseError("");
                }}
                placeholder={DEFAULT_API_BASE}
                className={`jl-input ${apiBaseError ? "jl-input--error" : ""}`}
                aria-invalid={apiBaseError ? true : undefined}
                style={{ fontSize: 12, height: 34 }}
              />
              <div className="jl-input-hint">{t("auth.apiBaseHint")}</div>
              {apiBaseError ? (
                <div className="jl-error-msg" role="alert">
                  <span
                    className="jl-error-icon"
                    dangerouslySetInnerHTML={{ __html: errorIconSvg(14) }}
                  />
                  <span>{apiBaseError}</span>
                </div>
              ) : null}
            </div>
          </div>

          <p style={{ fontSize: 12, color: "var(--jl-text-muted)", marginTop: 16, textAlign: "center" }}>
            {t("auth.setupHint")}
          </p>
        </>
      )}
    </div>
  );
}
