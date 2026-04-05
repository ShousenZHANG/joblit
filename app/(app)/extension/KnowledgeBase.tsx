"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Search,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  Globe,
  Monitor,
  Server,
  Filter,
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

type ScopeFilter = "all" | "global" | "ats" | "site";

export function KnowledgeBase() {
  const { toast } = useToast();
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editProfilePath, setEditProfilePath] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingRule, setDeletingRule] = useState<MappingRule | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/field-mappings");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setRules(json.data ?? []);
    } catch {
      toast({
        title: "Failed to load knowledge base",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const filteredRules = rules.filter((rule) => {
    const matchesSearch =
      !searchQuery ||
      (rule.fieldLabel ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.fieldSelector.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.profilePath.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (rule.staticValue ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (rule.atsProvider ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (rule.pageDomain ?? "").toLowerCase().includes(searchQuery.toLowerCase());

    const matchesScope =
      scopeFilter === "all" ||
      (scopeFilter === "global" && !rule.atsProvider && !rule.pageDomain) ||
      (scopeFilter === "ats" && rule.atsProvider && !rule.pageDomain) ||
      (scopeFilter === "site" && rule.pageDomain);

    return matchesSearch && matchesScope;
  });

  function startEdit(rule: MappingRule) {
    setEditingId(rule.id);
    setEditValue(rule.staticValue ?? "");
    setEditProfilePath(rule.profilePath);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setEditProfilePath("");
  }

  async function saveEdit(ruleId: string) {
    setSavingId(ruleId);
    try {
      const res = await fetch("/api/field-mappings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: ruleId,
          profilePath: editProfilePath,
          staticValue: editValue || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update");

      setRules((prev) =>
        prev.map((r) =>
          r.id === ruleId
            ? { ...r, profilePath: editProfilePath, staticValue: editValue || null }
            : r,
        ),
      );
      setEditingId(null);
      toast({ title: "Rule updated" });
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
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
      toast({ title: "Rule deleted" });
    } catch {
      toast({ title: "Failed to delete rule", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setDeletingRule(null);
    }
  }

  function getScopeIcon(rule: MappingRule) {
    if (rule.pageDomain) return <Monitor className="h-3.5 w-3.5" />;
    if (rule.atsProvider) return <Server className="h-3.5 w-3.5" />;
    return <Globe className="h-3.5 w-3.5" />;
  }

  function getScopeLabel(rule: MappingRule) {
    if (rule.pageDomain) return rule.pageDomain;
    if (rule.atsProvider) return rule.atsProvider;
    return "Global";
  }

  function getScopeBadgeClass(rule: MappingRule) {
    if (rule.pageDomain) return "kb-scope-badge kb-scope-site";
    if (rule.atsProvider) return "kb-scope-badge kb-scope-ats";
    return "kb-scope-badge kb-scope-global";
  }

  const scopeCounts = {
    all: rules.length,
    global: rules.filter((r) => !r.atsProvider && !r.pageDomain).length,
    ats: rules.filter((r) => r.atsProvider && !r.pageDomain).length,
    site: rules.filter((r) => !!r.pageDomain).length,
  };

  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-8">
        <div className="flex items-center justify-center gap-3 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading knowledge base...
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 rounded-xl border border-slate-200 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
              <Brain className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                AutoFill Knowledge Base
              </h2>
              <p className="text-xs text-slate-500">
                {rules.length} rule{rules.length !== 1 ? "s" : ""} learned from your corrections
              </p>
            </div>
          </div>
        </div>

        {rules.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">
              <Brain className="h-6 w-6 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">No rules yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Edit field values in the browser extension widget and they'll appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Toolbar: search + scope filters */}
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search fields, values, ATS..."
                  className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-300 focus:bg-white focus:ring-1 focus:ring-emerald-200"
                />
              </div>
              <div className="flex items-center gap-1">
                <Filter className="mr-1 h-3.5 w-3.5 text-slate-400" />
                {(["all", "global", "ats", "site"] as ScopeFilter[]).map((scope) => (
                  <button
                    key={scope}
                    onClick={() => setScopeFilter(scope)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                      scopeFilter === scope
                        ? "bg-emerald-50 text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    }`}
                  >
                    {scope === "all"
                      ? `All (${scopeCounts.all})`
                      : scope === "global"
                        ? `Global (${scopeCounts.global})`
                        : scope === "ats"
                          ? `ATS (${scopeCounts.ats})`
                          : `Site (${scopeCounts.site})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Rules list */}
            <div className="divide-y divide-slate-50">
              {filteredRules.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-slate-400">
                  No rules match your search.
                </div>
              ) : (
                filteredRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-slate-50/50"
                  >
                    {/* Scope badge */}
                    <div className={getScopeBadgeClass(rule)} title={getScopeLabel(rule)}>
                      {getScopeIcon(rule)}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-slate-800">
                          {rule.fieldLabel || rule.fieldSelector}
                        </span>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          {rule.source}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {rule.useCount}x used
                        </span>
                      </div>

                      {editingId === rule.id ? (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <input
                            type="text"
                            value={editProfilePath}
                            onChange={(e) => setEditProfilePath(e.target.value)}
                            placeholder="Profile path (e.g. fullName)"
                            className="h-7 flex-1 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-200"
                          />
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            placeholder="Static value (optional)"
                            className="h-7 flex-1 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-200"
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={() => saveEdit(rule.id)}
                              disabled={!editProfilePath || savingId === rule.id}
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                            >
                              {savingId === rule.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                            {rule.profilePath}
                          </code>
                          {rule.staticValue && (
                            <>
                              <span className="text-slate-300">=</span>
                              <span className="truncate italic text-slate-600">
                                "{rule.staticValue}"
                              </span>
                            </>
                          )}
                          {rule.atsProvider && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                              {rule.atsProvider}
                            </span>
                          )}
                          {rule.pageDomain && (
                            <span className="truncate rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                              {rule.pageDomain}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {editingId !== rule.id && (
                      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => startEdit(rule)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setDeletingRule(rule)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deletingRule} onOpenChange={(open) => !open && setDeletingRule(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete mapping rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the rule for{" "}
              <strong>{deletingRule?.fieldLabel || deletingRule?.fieldSelector}</strong>.
              The extension will no longer auto-fill this field based on this rule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteLoading}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-3.5 w-3.5" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
