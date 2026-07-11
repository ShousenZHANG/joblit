"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Brain,
  Search,
  Trash2,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Globe,
  Pencil,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface MappingRule {
  id: string;
  fieldSelector: string;
  fieldLabel: string | null;
  atsProvider: string | null;
  pageDomain: string | null;
  profilePath: string;
  staticValue: string | null;
  source: string;
  confidence: number;
  useCount: number;
  updatedAt: string;
}

interface RuleGroup {
  key: string;
  label: string;
  rules: MappingRule[];
}

export function KnowledgeBase() {
  const t = useTranslations("extension");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingRule, setDeletingRule] = useState<MappingRule | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const editInputRef = useRef<HTMLInputElement>(null);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/field-mappings");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setRules(json.data ?? []);
    } catch {
      toast({
        title: t("kb.toastLoadFailed"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Filter rules by search query
  const filteredRules = useMemo(() => {
    if (!searchQuery) return rules;
    const q = searchQuery.toLowerCase();
    return rules.filter(
      (rule) =>
        (rule.fieldLabel ?? "").toLowerCase().includes(q) ||
        (rule.staticValue ?? "").toLowerCase().includes(q) ||
        (rule.atsProvider ?? "").toLowerCase().includes(q) ||
        rule.profilePath.toLowerCase().includes(q),
    );
  }, [rules, searchQuery]);

  // Group filtered rules by ATS provider
  const groups: RuleGroup[] = useMemo(() => {
    const map = new Map<string, MappingRule[]>();
    for (const rule of filteredRules) {
      const key = rule.atsProvider || "global";
      const existing = map.get(key);
      if (existing) {
        existing.push(rule);
      } else {
        map.set(key, [rule]);
      }
    }
    // Sort groups: most rules first, "global" last
    return Array.from(map.entries())
      .sort(([aKey, aRules], [bKey, bRules]) => {
        if (aKey === "global") return 1;
        if (bKey === "global") return -1;
        return bRules.length - aRules.length;
      })
      .map(([key, groupRules]) => ({
        key,
        label: key === "global" ? t("kb.globalGroup") : key,
        rules: groupRules.sort((a, b) => b.useCount - a.useCount),
      }));
  }, [filteredRules, t]);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function startEdit(rule: MappingRule) {
    setEditingId(rule.id);
    setEditValue(rule.staticValue ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  async function saveEdit(ruleId: string) {
    if (!editValue.trim()) return;
    setSavingId(ruleId);
    try {
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) return;
      const res = await fetch("/api/field-mappings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: ruleId,
          profilePath: rule.profilePath,
          staticValue: editValue.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to update");

      setRules((prev) =>
        prev.map((r) =>
          r.id === ruleId ? { ...r, staticValue: editValue.trim() } : r,
        ),
      );
      setEditingId(null);
      toast({ title: t("kb.toastAnswerUpdated") });
    } catch {
      toast({ title: t("kb.toastUpdateFailed"), variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  }

  async function confirmDelete() {
    if (!deletingRule) return;
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/field-mappings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deletingRule.id }),
      });
      if (!res.ok) throw new Error("Failed to delete");

      setRules((prev) => prev.filter((r) => r.id !== deletingRule.id));
      toast({ title: t("kb.toastRuleDeleted") });
    } catch {
      toast({ title: t("kb.toastDeleteFailed"), variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setDeletingRule(null);
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent, ruleId: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit(ruleId);
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  }

  // ── Render ──

  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-card p-8">
        <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground/70">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          {t("kb.loading")}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 rounded-xl border border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-emerald-50">
              <Brain className="h-4 w-4 text-brand-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {t("kb.heading")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("kb.rulesLearned", { count: rules.length })}
              </p>
            </div>
          </div>
        </div>

        {rules.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
              <Brain className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {t("kb.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {t("kb.emptyBody")}
            </p>
          </div>
        ) : (
          <>
            {/* Search bar */}
            <div className="border-b border-border/60 px-5 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("kb.searchPlaceholder")}
                  className="h-8 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-xs text-foreground/85 outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-brand-emerald-300 focus:bg-card focus:ring-1 focus:ring-brand-emerald-200"
                />
              </div>
            </div>

            {/* Grouped table */}
            {groups.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-muted-foreground/70">
                {t("kb.noSearchMatch")}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {groups.map((group) => {
                  const isCollapsed = collapsedGroups.has(group.key);
                  return (
                    <div key={group.key}>
                      {/* Group header */}
                      <button
                        onClick={() => toggleGroup(group.key)}
                        className="flex w-full items-center gap-2 px-5 py-2.5 text-left transition-colors hover:bg-muted/40"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70" />
                        )}
                        {group.key === "global" ? (
                          <Globe className="h-3.5 w-3.5 text-muted-foreground/70" />
                        ) : (
                          <div className="flex h-4 w-4 items-center justify-center rounded bg-brand-emerald-50 text-[8px] font-bold text-brand-emerald-600">
                            {group.label[0].toUpperCase()}
                          </div>
                        )}
                        <span className="text-xs font-semibold text-foreground/85">
                          {group.label}
                        </span>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {group.rules.length}
                        </span>
                      </button>

                      {/* Table rows */}
                      {!isCollapsed && (
                        <div className="pb-1">
                          {/* Table header */}
                          <div className="grid grid-cols-[1fr_1.5fr_50px_36px] gap-2 px-5 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                            <div className="pl-6">{t("kb.columnField")}</div>
                            <div>{t("kb.columnAnswer")}</div>
                            <div className="text-center">{t("kb.columnUsed")}</div>
                            <div />
                          </div>

                          {/* Rules */}
                          {group.rules.map((rule) => (
                            <div
                              key={rule.id}
                              className="group grid grid-cols-[1fr_1.5fr_50px_36px] items-center gap-2 px-5 py-1.5 transition-colors hover:bg-muted/60"
                            >
                              {/* Field name */}
                              <div className="truncate pl-6 text-xs font-medium text-foreground/85" title={rule.fieldLabel || rule.fieldSelector}>
                                {rule.fieldLabel || rule.fieldSelector}
                              </div>

                              {/* Answer — inline editable */}
                              {editingId === rule.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    ref={editInputRef}
                                    type="text"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => handleEditKeyDown(e, rule.id)}
                                    onBlur={() => {
                                      // Small delay so button clicks register
                                      setTimeout(() => {
                                        if (editingId === rule.id) cancelEdit();
                                      }, 150);
                                    }}
                                    className="h-6 w-full min-w-0 rounded border border-brand-emerald-300 bg-card px-2 text-xs text-foreground/90 outline-none ring-1 ring-brand-emerald-200"
                                  />
                                  <button
                                    onClick={() => saveEdit(rule.id)}
                                    disabled={savingId === rule.id}
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand-emerald-50 text-brand-emerald-600 hover:bg-brand-emerald-100"
                                  >
                                    {savingId === rule.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                                    ) : (
                                      <Check className="h-3 w-3" />
                                    )}
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEdit(rule)}
                                  className="group/cell flex items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-brand-emerald-50 hover:text-brand-emerald-text"
                                  title={t("kb.clickToEdit")}
                                >
                                  <span className="truncate">
                                    {rule.staticValue || (
                                      <span className="italic text-muted-foreground/40">
                                        {t("kb.noValue")}
                                      </span>
                                    )}
                                  </span>
                                  <Pencil className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover/cell:opacity-100" />
                                </button>
                              )}

                              {/* Use count */}
                              <div className="text-center text-[11px] text-muted-foreground/70">
                                {rule.useCount}x
                              </div>

                              {/* Delete */}
                              <button
                                onClick={() => setDeletingRule(rule)}
                                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                                title={tc("delete")}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deletingRule}
        onOpenChange={(open) => !open && setDeletingRule(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("kb.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich("kb.deleteBody", {
                field:
                  deletingRule?.fieldLabel || deletingRule?.fieldSelector || "",
                value: deletingRule?.staticValue ?? "",
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>
              {tc("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteLoading}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Trash2 className="mr-2 h-3.5 w-3.5" />
              )}
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
