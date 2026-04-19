"use client";

import { useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wand2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResumeImportOutput, CoverImportOutput } from "../types";

type JsonInputPanelProps = {
  value: string;
  onChange: (value: string) => void;
  target: "resume" | "cover";
  parsedOutput: ResumeImportOutput | CoverImportOutput | null;
};

function tryAutoFix(raw: string): string {
  let fixed = raw;
  // Strip markdown code fences
  fixed = fixed.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "");
  // Replace curly quotes
  fixed = fixed.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // Replace non-breaking spaces
  fixed = fixed.replace(/\u00A0/g, " ");
  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, "$1");
  return fixed.trim();
}

function getResumePreview(parsed: ResumeImportOutput) {
  const summary = parsed.cvSummary || "";
  return {
    summaryLength: summary.length,
    summaryPreview: summary.slice(0, 120) + (summary.length > 120 ? "..." : ""),
  };
}

function getCoverPreview(parsed: CoverImportOutput) {
  const c = parsed.cover;
  return {
    hasP1: Boolean(c.paragraphOne),
    hasP2: Boolean(c.paragraphTwo),
    hasP3: Boolean(c.paragraphThree),
    p1Preview: (c.paragraphOne || "").slice(0, 80) + ((c.paragraphOne?.length ?? 0) > 80 ? "..." : ""),
    subject: c.subject || "",
    salutation: c.salutation || "",
  };
}

export function JsonInputPanel({
  value,
  onChange,
  target,
  parsedOutput,
}: JsonInputPanelProps) {
  const [showPreview, setShowPreview] = useState(true);
  const hasInput = value.trim().length > 0;
  const isValid = hasInput && parsedOutput !== null;
  const isInvalid = hasInput && parsedOutput === null;

  const handleAutoFix = useCallback(() => {
    const fixed = tryAutoFix(value);
    if (fixed !== value) onChange(fixed);
  }, [value, onChange]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Input + Preview grid */}
      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1fr,240px]">
        {/* Textarea */}
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            target === "resume"
              ? '{\n  "cvSummary": "...",\n  "latestExperience": {\n    "bullets": ["..."]\n  },\n  "skillsFinal": [...]\n}'
              : '{\n  "cover": {\n    "paragraphOne": "...",\n    "paragraphTwo": "...",\n    "paragraphThree": "..."\n  }\n}'
          }
          className="min-h-[180px] resize-none font-mono text-xs leading-relaxed md:min-h-0"
        />

        {/* Preview panel (desktop: side, mobile: collapsible) */}
        <div className="hidden flex-col md:flex">
          {!hasInput ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 p-3">
              <p className="text-center text-xs text-muted-foreground/70">
                Paste your AI output on the left to see a preview here
              </p>
            </div>
          ) : isValid ? (
            <div className="overflow-y-auto rounded-lg border border-brand-emerald-200 bg-white p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-emerald-600">
                Preview
              </div>
              {parsedOutput && "cvSummary" in parsedOutput ? (
                <ResumePreviewContent parsed={parsedOutput as ResumeImportOutput} />
              ) : parsedOutput && "cover" in parsedOutput ? (
                <CoverPreviewContent parsed={parsedOutput as CoverImportOutput} />
              ) : null}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10/50 p-3">
              <p className="text-center text-xs text-rose-500">
                Invalid JSON &mdash; fix errors to see preview
              </p>
            </div>
          )}
        </div>

        {/* Mobile preview toggle */}
        {hasInput && isValid && (
          <div className="md:hidden">
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-muted-foreground"
            >
              {showPreview ? "Hide preview" : "Show preview"}
              {showPreview ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            {showPreview && (
              <div className="mt-2 rounded-lg border border-brand-emerald-200 bg-white p-3">
                {target === "resume" && "cvSummary" in parsedOutput! ? (
                  <ResumePreviewContent parsed={parsedOutput as ResumeImportOutput} />
                ) : (
                  <CoverPreviewContent parsed={parsedOutput as CoverImportOutput} />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Validation status bar */}
      {!hasInput ? null : isValid ? (
        <div className="flex items-center gap-2 rounded-lg border border-brand-emerald-200 bg-brand-emerald-50/60 px-3 py-2 text-xs text-brand-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600" />
          Valid JSON &mdash; ready to generate
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Couldn&apos;t parse the JSON</div>
              <ul className="mt-1 space-y-0.5 text-amber-800/80">
                <li>
                  &bull; Remove <code className="rounded bg-amber-100 px-1 font-mono">```json</code> and{" "}
                  <code className="rounded bg-amber-100 px-1 font-mono">```</code> markers
                </li>
                <li>&bull; Make sure all quotes are straight &quot; not curly</li>
                <li>&bull; Check for trailing commas</li>
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAutoFix}
                className="mt-2 h-7 gap-1 rounded-md border-amber-300 bg-white px-2.5 text-[11px] font-medium text-amber-800 hover:bg-amber-50"
              >
                <Wand2 className="h-3 w-3" />
                Auto-fix JSON
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResumePreviewContent({ parsed }: { parsed: ResumeImportOutput }) {
  const { summaryLength, summaryPreview } = getResumePreview(parsed);
  return (
    <div className="space-y-2.5 text-xs">
      <div>
        <div className="font-medium text-foreground/85">Summary</div>
        <p className="mt-0.5 text-muted-foreground">{summaryPreview}</p>
        <span className="text-[10px] text-muted-foreground/70">{summaryLength} chars</span>
      </div>
    </div>
  );
}

function CoverPreviewContent({ parsed }: { parsed: CoverImportOutput }) {
  const preview = getCoverPreview(parsed);
  return (
    <div className="space-y-2.5 text-xs">
      {preview.subject && (
        <div>
          <div className="font-medium text-foreground/85">Subject</div>
          <p className="mt-0.5 text-muted-foreground">{preview.subject}</p>
        </div>
      )}
      <div>
        <div className="font-medium text-foreground/85">Paragraphs</div>
        <div className="mt-1 space-y-1">
          {[
            { ok: preview.hasP1, label: "Intent" },
            { ok: preview.hasP2, label: "Evidence" },
            { ok: preview.hasP3, label: "Motivation" },
          ].map((p) => (
            <div key={p.label} className="flex items-center gap-1.5">
              {p.ok ? (
                <CheckCircle2 className="h-3 w-3 text-brand-emerald-500" />
              ) : (
                <XCircle className="h-3 w-3 text-rose-400" />
              )}
              <span className={p.ok ? "text-muted-foreground" : "text-rose-500"}>
                {p.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      {preview.p1Preview && (
        <div>
          <div className="font-medium text-foreground/85">Preview</div>
          <p className="mt-0.5 text-muted-foreground">{preview.p1Preview}</p>
        </div>
      )}
    </div>
  );
}
