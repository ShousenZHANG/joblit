"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type Template = {
  id: string;
  name: string;
  version: number;
  locale: string;
  isActive: boolean;
  cvRules: string[];
  coverRules: string[];
  hardConstraints: string[];
  updatedAt: string;
};

function parseLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatLines(value: string[]) {
  return value.join("\n");
}

export function PromptRulesManager() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [downloadingPack, setDownloadingPack] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const activeTemplate = useMemo(
    () => templates.find((item) => item.isActive) ?? templates[0] ?? null,
    [templates],
  );

  const [name, setName] = useState("");
  const [cvRulesText, setCvRulesText] = useState("");
  const [coverRulesText, setCoverRulesText] = useState("");
  const [hardRulesText, setHardRulesText] = useState("");

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prompt-rules", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || json?.error || "Failed to load templates");
      const next = (json.templates ?? []) as Template[];
      setTemplates(next);
      const active = next.find((item) => item.isActive) ?? next[0];
      if (active) {
        setName(`${active.name} (copy)`);
        setCvRulesText(formatLines(active.cvRules));
        setCoverRulesText(formatLines(active.coverRules));
        setHardRulesText(formatLines(active.hardConstraints));
      }
    } catch (error) {
      toast({
        title: "Load failed",
        description: error instanceof Error ? error.message : "Failed to load templates.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  async function createTemplate() {
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || `Rules copy ${new Date().toISOString()}`,
        cvRules: parseLines(cvRulesText),
        coverRules: parseLines(coverRulesText),
        hardConstraints: parseLines(hardRulesText),
      };
      const res = await fetch("/api/prompt-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || json?.error || "Failed to create template");
      toast({ title: "Template created", description: "New rules version saved." });
      await loadTemplates();
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save template.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function activateTemplate(templateId: string) {
    setActivatingId(templateId);
    try {
      const res = await fetch(`/api/prompt-rules/${templateId}/activate`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || json?.error || "Failed to activate template");
      toast({ title: "Activated", description: "This version is now used by prompt generation." });
      await loadTemplates();
    } catch (error) {
      toast({
        title: "Activate failed",
        description: error instanceof Error ? error.message : "Failed to activate template.",
        variant: "destructive",
      });
    } finally {
      setActivatingId(null);
    }
  }

  async function resetToDefault() {
    setResetting(true);
    try {
      const res = await fetch("/api/prompt-rules/reset-default", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || json?.error || "Failed to reset");
      toast({ title: "Default restored", description: "A new default version is now active." });
      await loadTemplates();
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error instanceof Error ? error.message : "Failed to reset.",
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  }

  async function downloadSkillPack() {
    setDownloadingPack(true);
    try {
      const res = await fetch("/api/prompt-rules/skill-pack", { cache: "no-store" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || json?.error || "Failed to download skill pack");
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition");
      const fallbackName = "jobflow-tailoring.tar.gz";
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] ?? fallbackName;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: "Global skill pack saved." });
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Failed to download skill pack.",
        variant: "destructive",
      });
    } finally {
      setDownloadingPack(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900/10 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Active rules</h2>
            <p className="text-sm text-muted-foreground">
              Prompt generation uses the active template version.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={downloadSkillPack} disabled={downloadingPack}>
              {downloadingPack ? "Preparing..." : "Download skill pack"}
            </Button>
            <Button variant="outline" onClick={resetToDefault} disabled={resetting}>
              {resetting ? "Resetting..." : "Restore default"}
            </Button>
          </div>
        </div>
        {activeTemplate ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{activeTemplate.name}</Badge>
            <Badge variant="secondary">v{activeTemplate.version}</Badge>
            <span className="text-muted-foreground">Locale: {activeTemplate.locale}</span>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No template found.</div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-900/10 bg-white p-4">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Create new version</h2>
          <p className="text-sm text-muted-foreground">
            Edit rules and save as a new template version.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Version name</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Rules v2" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">CV rules (one per line)</label>
            <Textarea
              className="min-h-[120px]"
              value={cvRulesText}
              onChange={(event) => setCvRulesText(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Cover rules (one per line)</label>
            <Textarea
              className="min-h-[120px]"
              value={coverRulesText}
              onChange={(event) => setCoverRulesText(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Hard constraints (one per line)</label>
            <Textarea
              className="min-h-[120px]"
              value={hardRulesText}
              onChange={(event) => setHardRulesText(event.target.value)}
            />
          </div>
          <Button onClick={createTemplate} disabled={saving}>
            {saving ? "Saving..." : "Save new version"}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-900/10 bg-white p-4">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Version history</h2>
          <p className="text-sm text-muted-foreground">
            Activate any previous version instantly.
          </p>
        </div>
        <div className="space-y-2">
          {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
          {!loading && templates.length === 0 ? (
            <div className="text-sm text-muted-foreground">No versions found.</div>
          ) : null}
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-900/10 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{template.name}</span>
                <Badge variant="secondary">v{template.version}</Badge>
                {template.isActive ? <Badge>Active</Badge> : null}
              </div>
              <Button
                variant="outline"
                disabled={template.isActive || activatingId === template.id}
                onClick={() => activateTemplate(template.id)}
              >
                {activatingId === template.id ? "Activating..." : template.isActive ? "Active" : "Activate"}
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
