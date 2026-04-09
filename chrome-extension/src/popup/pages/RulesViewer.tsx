import { useState, useEffect, useCallback } from "react";
import { t } from "@ext/shared/i18n";

interface SavedRule {
  fieldLabel: string | null;
  atsProvider: string | null;
  pageDomain: string | null;
  profilePath: string;
  staticValue: string | null;
  confidence: number;
  useCount: number;
}

export function RulesViewer() {
  const [rules, setRules] = useState<SavedRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage(
      { type: "GET_FIELD_MAPPINGS", params: {} },
      (response) => {
        setLoading(false);
        if (response?.success && Array.isArray(response.data)) {
          setRules(response.data);
        }
      },
    );
  }, []);

  const handleClearAll = useCallback(() => {
    chrome.storage.local.remove("fieldMappings", () => {
      setRules([]);
    });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="jl-section-label">Saved Rules</div>
        {rules.length > 0 && (
          <button
            onClick={handleClearAll}
            className="jl-btn jl-btn--ghost"
            style={{ fontSize: 11, padding: "2px 8px", color: "#ef4444" }}
          >
            Clear all
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="jl-skeleton" style={{ width: "100%", height: 40 }} />
          <div className="jl-skeleton" style={{ width: "100%", height: 40 }} />
          <div className="jl-skeleton" style={{ width: "80%", height: 40 }} />
        </div>
      ) : rules.length === 0 ? (
        <div className="jl-empty" style={{ padding: "24px 0" }}>
          <div className="jl-empty-icon" style={{ width: 36, height: 36, borderRadius: 10 }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12M2 6.5h12M2 10h8M2 13.5h5" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="jl-empty-desc">
            No saved rules yet. Fill a form and edit fields to create rules.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: "var(--jl-text-muted)" }}>
            {rules.length} rule{rules.length !== 1 ? "s" : ""} saved
          </div>
          {rules.map((rule, i) => (
            <div
              key={i}
              className="jl-card"
              style={{
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {rule.fieldLabel || rule.profilePath}
                </div>
                <div style={{ fontSize: 10, color: "var(--jl-text-muted)", marginTop: 1 }}>
                  {rule.atsProvider ? `${rule.atsProvider}` : "All sites"}
                  {rule.pageDomain ? ` · ${rule.pageDomain}` : ""}
                  {rule.useCount > 0 ? ` · Used ${rule.useCount}×` : ""}
                </div>
              </div>
              <div style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "2px 8px",
                borderRadius: 6,
                background: "var(--jl-emerald-50)",
                color: "var(--jl-emerald-700)",
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}>
                {rule.staticValue || rule.profilePath}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
