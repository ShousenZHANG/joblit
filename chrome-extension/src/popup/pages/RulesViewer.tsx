import { useState, useEffect, useCallback } from "react";
import { t } from "@ext/shared/i18n";

interface SavedRule {
  fieldSelector: string;
  fieldLabel: string | null;
  atsProvider: string | null;
  pageDomain: string | null;
  profilePath: string;
  staticValue: string | null;
  source: string;
  confidence: number;
  useCount: number;
}

type ScopeFilter = "all" | "global" | "ats" | "site";

function getScopeLabel(rule: SavedRule): string {
  if (rule.pageDomain) return rule.pageDomain;
  if (rule.atsProvider) return rule.atsProvider;
  return "Global";
}

function getScopeType(rule: SavedRule): ScopeFilter {
  if (rule.pageDomain) return "site";
  if (rule.atsProvider) return "ats";
  return "global";
}

const SCOPE_STYLES: Record<ScopeFilter, { bg: string; color: string; border: string }> = {
  all: { bg: "#f8fafc", color: "#475569", border: "#e2e8f0" },
  global: { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0" },
  ats: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
  site: { bg: "#fefce8", color: "#854d0e", border: "#fde68a" },
};

export function RulesViewer() {
  const [rules, setRules] = useState<SavedRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const loadRules = useCallback(() => {
    setLoading(true);
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

  useEffect(() => { loadRules(); }, [loadRules]);

  const handleClearAll = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    chrome.storage.local.remove("fieldMappings", () => {
      setRules([]);
      setConfirmClear(false);
    });
  }, [confirmClear]);

  const handleDelete = useCallback((idx: number) => {
    const updated = rules.filter((_, i) => i !== idx);
    setRules(updated);
    // Persist updated rules
    chrome.runtime.sendMessage({
      type: "PUT_FIELD_MAPPING",
      data: { action: "replace_all", mappings: updated },
    });
  }, [rules]);

  const handleSaveEdit = useCallback((idx: number) => {
    const updated = rules.map((r, i) =>
      i === idx ? { ...r, staticValue: editValue } : r,
    );
    setRules(updated);
    setEditingIdx(null);
    chrome.runtime.sendMessage({
      type: "PUT_FIELD_MAPPING",
      data: { action: "replace_all", mappings: updated },
    });
  }, [rules, editValue]);

  // Filter + search
  const filtered = rules.filter((rule) => {
    if (filter !== "all" && getScopeType(rule) !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const label = (rule.fieldLabel || rule.profilePath || "").toLowerCase();
      const value = (rule.staticValue || rule.profilePath || "").toLowerCase();
      return label.includes(q) || value.includes(q);
    }
    return true;
  });

  // Counts per scope
  const counts = {
    all: rules.length,
    global: rules.filter((r) => getScopeType(r) === "global").length,
    ats: rules.filter((r) => getScopeType(r) === "ats").length,
    site: rules.filter((r) => getScopeType(r) === "site").length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="jl-section-label" style={{ margin: 0 }}>
          {t("tab.rules")} ({rules.length})
        </div>
        {rules.length > 0 && (
          <button
            onClick={handleClearAll}
            className="jl-btn jl-btn--ghost"
            style={{
              fontSize: 10,
              padding: "2px 8px",
              color: confirmClear ? "#fff" : "#ef4444",
              background: confirmClear ? "#ef4444" : "transparent",
              borderRadius: 6,
            }}
          >
            {confirmClear ? "Confirm clear?" : "Clear all"}
          </button>
        )}
      </div>

      {/* Scope filter chips */}
      {rules.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(["all", "global", "ats", "site"] as ScopeFilter[]).map((scope) => {
            const active = filter === scope;
            const style = SCOPE_STYLES[scope];
            return (
              <button
                key={scope}
                onClick={() => setFilter(scope)}
                style={{
                  fontSize: 10,
                  fontWeight: active ? 600 : 400,
                  padding: "3px 8px",
                  borderRadius: 999,
                  border: `1px solid ${active ? style.border : "#e2e8f0"}`,
                  background: active ? style.bg : "transparent",
                  color: active ? style.color : "#94a3b8",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {scope === "all" ? "All" : scope === "global" ? "Global" : scope === "ats" ? "ATS" : "Site"}
                {counts[scope] > 0 && ` (${counts[scope]})`}
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      {rules.length > 3 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rules..."
          className="jl-input"
          style={{ fontSize: 11, height: 28, padding: "0 8px" }}
        />
      )}

      {/* Content */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="jl-skeleton" style={{ width: "100%", height: 48 }} />
          <div className="jl-skeleton" style={{ width: "100%", height: 48 }} />
          <div className="jl-skeleton" style={{ width: "90%", height: 48 }} />
        </div>
      ) : rules.length === 0 ? (
        <div className="jl-empty" style={{ padding: "20px 0" }}>
          <div className="jl-empty-icon" style={{ width: 32, height: 32, borderRadius: 8 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12M2 6.5h12M2 10h8M2 13.5h5" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="jl-empty-desc" style={{ fontSize: 11 }}>
            No rules yet. Fill a form and edit fields in the widget to create rules.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--jl-text-muted)", textAlign: "center", padding: 16 }}>
          No rules match this filter.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
          {filtered.map((rule, i) => {
            const realIdx = rules.indexOf(rule);
            const isEditing = editingIdx === realIdx;
            const scopeType = getScopeType(rule);
            const scopeStyle = SCOPE_STYLES[scopeType];

            return (
              <div
                key={realIdx}
                className="jl-card"
                style={{
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  borderLeft: `3px solid ${scopeStyle.border}`,
                }}
              >
                {/* Content */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {rule.fieldLabel || rule.profilePath}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <span style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: scopeStyle.bg,
                      color: scopeStyle.color,
                      border: `1px solid ${scopeStyle.border}`,
                      fontWeight: 500,
                    }}>
                      {getScopeLabel(rule)}
                    </span>
                    {rule.useCount > 0 && (
                      <span style={{ fontSize: 9, color: "var(--jl-text-muted)" }}>
                        {rule.useCount}x
                      </span>
                    )}
                  </div>
                </div>

                {/* Value */}
                {isEditing ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit(realIdx);
                        if (e.key === "Escape") setEditingIdx(null);
                      }}
                      autoFocus
                      className="jl-input"
                      style={{ fontSize: 10, height: 22, width: 80, padding: "0 4px" }}
                    />
                    <button
                      onClick={() => handleSaveEdit(realIdx)}
                      style={{ fontSize: 10, color: "#22c55e", cursor: "pointer", background: "none", border: "none", padding: 2 }}
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => setEditingIdx(null)}
                      style={{ fontSize: 10, color: "#94a3b8", cursor: "pointer", background: "none", border: "none", padding: 2 }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                    <button
                      onClick={() => { setEditingIdx(realIdx); setEditValue(rule.staticValue || rule.profilePath); }}
                      title="Edit value"
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--jl-emerald-50)",
                        color: "var(--jl-emerald-700)",
                        maxWidth: 90,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                        border: "1px solid var(--jl-emerald-100, #d1fae5)",
                      }}
                    >
                      {rule.staticValue || rule.profilePath}
                    </button>
                    <button
                      onClick={() => handleDelete(realIdx)}
                      title="Delete rule"
                      style={{
                        fontSize: 11,
                        color: "#ef4444",
                        cursor: "pointer",
                        background: "none",
                        border: "none",
                        padding: "0 2px",
                        opacity: 0.6,
                      }}
                      onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = "1"; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = "0.6"; }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
