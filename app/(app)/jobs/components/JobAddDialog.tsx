import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Plus,
  Link2,
  Briefcase,
  Building2,
  MapPin,
  Clock,
  BarChart3,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { invalidateActiveJobsQueries } from "../utils/jobsQueryCache";

const ADD_JOB_EMPTY = "__";

const AU_LOCATION_OPTIONS = [
  { value: "New South Wales, Australia", label: "New South Wales" },
  { value: "Victoria, Australia", label: "Victoria" },
  { value: "Queensland, Australia", label: "Queensland" },
  { value: "Western Australia, Australia", label: "Western Australia" },
  { value: "South Australia, Australia", label: "South Australia" },
  { value: "Australian Capital Territory, Australia", label: "ACT" },
  { value: "Tasmania, Australia", label: "Tasmania" },
  { value: "Northern Territory, Australia", label: "Northern Territory" },
];

const ADD_JOB_LOCATION_OPTIONS = [
  { value: ADD_JOB_EMPTY, label: "—" },
  ...AU_LOCATION_OPTIONS,
];

const ADD_JOB_TYPE_OPTIONS = [
  { value: ADD_JOB_EMPTY, label: "—" },
  { value: "Full-time", label: "Full-time" },
  { value: "Part-time", label: "Part-time" },
  { value: "Contract", label: "Contract" },
  { value: "Internship", label: "Internship" },
  { value: "Casual", label: "Casual" },
];

const ADD_JOB_LEVEL_OPTIONS = [
  { value: ADD_JOB_EMPTY, label: "—" },
  { value: "Entry level", label: "Entry level" },
  { value: "Mid-Senior", label: "Mid-Senior" },
];

const EMPTY_FORM = {
  jobUrl: "",
  title: "",
  company: "",
  location: "",
  jobType: "",
  jobLevel: "",
  description: "",
};

const DESC_MAX_LENGTH = 5000;

/** Lightweight client-side URL format check. */
function isValidUrl(val: string): boolean {
  try {
    new URL(val);
    return true;
  } catch {
    return false;
  }
}

/** Branded field label with icon + optional required dot */
function FieldLabel({
  icon: Icon,
  children,
  required,
  htmlFor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-foreground/85"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
      {children}
      {required && (
        <span className="ml-0.5 text-brand-emerald-500" aria-label="required">*</span>
      )}
    </label>
  );
}

export function JobAddDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tc = useTranslations("common");
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus URL input when dialog opens; reset state when it closes
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => urlInputRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
    // Dialog just closed — cancel any pending success timer
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    setSuccess(false);
  }, [open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      // Cancel success timer if user manually closes before it fires
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
      setError(null);
      setSuccess(false);
      setForm(EMPTY_FORM);
    }
    onOpenChange(nextOpen);
  }

  function updateField<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobUrl: form.jobUrl.trim(),
          title: form.title.trim(),
          company: form.company.trim() || undefined,
          location: form.location === ADD_JOB_EMPTY ? undefined : form.location.trim() || undefined,
          jobType: form.jobType === ADD_JOB_EMPTY ? undefined : form.jobType.trim() || undefined,
          jobLevel: form.jobLevel === ADD_JOB_EMPTY ? undefined : form.jobLevel.trim() || undefined,
          description: form.description.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setSuccess(true);
        invalidateActiveJobsQueries(queryClient);
        toast?.({ title: "Job added", description: form.title.trim() });
        // Brief success state, then close (guarded by ref so cleanup can cancel)
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null;
          onOpenChange(false);
          setForm(EMPTY_FORM);
          setSuccess(false);
        }, 600);
        return;
      }
      if (res.status === 409 && json.error === "JOB_URL_EXISTS") {
        setError("This job link already exists in your list.");
        return;
      }
      setError(typeof json?.error === "string" ? json.error : "Failed to add job. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const urlTrimmed = form.jobUrl.trim();
  const canSubmit = urlTrimmed.length > 0 && isValidUrl(urlTrimmed) && form.title.trim().length > 0 && !submitting && !success;
  const descLength = form.description.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden rounded-2xl border-border/80 p-0 shadow-xl sm:max-w-xl">
        {/* ── Header ── */}
        <div className="border-b border-border/60 bg-gradient-to-b from-slate-50/80 to-white px-6 pb-4 pt-5">
          <DialogHeader className="gap-1.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
                <Plus className="h-4 w-4 text-brand-emerald-600" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
                Add Job
              </DialogTitle>
            </div>
            <DialogDescription className="pl-[42px] text-[13px] leading-relaxed text-muted-foreground">
              Paste a job URL and fill in the details. Required fields are marked with *.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ── Form ── */}
        <form
          className="flex flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) handleSubmit();
          }}
        >
          <div className="max-h-[min(60dvh,520px)] space-y-5 overflow-y-auto px-6 py-5">
            {/* URL — primary input, visually distinct */}
            <div>
              <FieldLabel icon={Link2} required htmlFor="add-job-url">
                Job URL
              </FieldLabel>
              <Input
                ref={urlInputRef}
                id="add-job-url"
                type="url"
                placeholder="https://www.seek.com.au/job/..."
                value={form.jobUrl}
                onChange={(e) => updateField("jobUrl", e.target.value)}
                required
                className="h-10 rounded-xl border-border bg-muted/40 pl-3 pr-3 text-sm transition-all duration-150 placeholder:text-muted-foreground/70 focus-visible:border-brand-emerald-300 focus-visible:bg-white focus-visible:ring-brand-emerald-100"
              />
              {urlTrimmed.length > 0 && !isValidUrl(urlTrimmed) && (
                <p className="mt-1 text-[11px] text-amber-500">
                  Please enter a valid URL (e.g. https://...)
                </p>
              )}
            </div>

            {/* Title + Company — side by side */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel icon={Briefcase} required htmlFor="add-job-title">
                  Title
                </FieldLabel>
                <Input
                  id="add-job-title"
                  type="text"
                  placeholder="e.g. Software Engineer"
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  required
                  className="h-10 rounded-xl border-border bg-muted/40 text-sm transition-all duration-150 placeholder:text-muted-foreground/70 focus-visible:border-brand-emerald-300 focus-visible:bg-white focus-visible:ring-brand-emerald-100"
                />
              </div>
              <div>
                <FieldLabel icon={Building2} htmlFor="add-job-company">
                  Company
                </FieldLabel>
                <Input
                  id="add-job-company"
                  type="text"
                  placeholder="Company name"
                  value={form.company}
                  onChange={(e) => updateField("company", e.target.value)}
                  className="h-10 rounded-xl border-border bg-muted/40 text-sm transition-all duration-150 placeholder:text-muted-foreground/70 focus-visible:border-brand-emerald-300 focus-visible:bg-white focus-visible:ring-brand-emerald-100"
                />
              </div>
            </div>

            {/* Location + Type + Level — compact row */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel icon={MapPin} htmlFor="add-job-location">Location</FieldLabel>
                <Select
                  value={form.location || ADD_JOB_EMPTY}
                  onValueChange={(v) => updateField("location", v)}
                >
                  <SelectTrigger
                    id="add-job-location"
                    className="h-10 rounded-xl border-border bg-muted/40 text-sm transition-all duration-150 focus:border-brand-emerald-300 focus:ring-brand-emerald-100 [&>span]:text-muted-foreground"
                  >
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADD_JOB_LOCATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel icon={Clock} htmlFor="add-job-type">Type</FieldLabel>
                <Select
                  value={form.jobType || ADD_JOB_EMPTY}
                  onValueChange={(v) => updateField("jobType", v)}
                >
                  <SelectTrigger
                    id="add-job-type"
                    className="h-10 rounded-xl border-border bg-muted/40 text-sm transition-all duration-150 focus:border-brand-emerald-300 focus:ring-brand-emerald-100 [&>span]:text-muted-foreground"
                  >
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADD_JOB_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel icon={BarChart3} htmlFor="add-job-level">Level</FieldLabel>
                <Select
                  value={form.jobLevel || ADD_JOB_EMPTY}
                  onValueChange={(v) => updateField("jobLevel", v)}
                >
                  <SelectTrigger
                    id="add-job-level"
                    className="h-10 rounded-xl border-border bg-muted/40 text-sm transition-all duration-150 focus:border-brand-emerald-300 focus:ring-brand-emerald-100 [&>span]:text-muted-foreground"
                  >
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADD_JOB_LEVEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div>
              <FieldLabel icon={FileText} htmlFor="add-job-description">
                Description
              </FieldLabel>
              <Textarea
                id="add-job-description"
                placeholder="Paste the job description (optional — helps with tailored resume generation)"
                value={form.description}
                onChange={(e) => {
                  if (e.target.value.length <= DESC_MAX_LENGTH) {
                    updateField("description", e.target.value);
                  }
                }}
                className="min-h-[100px] max-h-[240px] resize-y rounded-xl border-border bg-muted/40 text-sm transition-all duration-150 placeholder:text-muted-foreground/70 focus-visible:border-brand-emerald-300 focus-visible:bg-white focus-visible:ring-brand-emerald-100"
              />
              {descLength > 0 && (
                <div
                  className={`mt-1 text-right text-[11px] ${
                    descLength >= DESC_MAX_LENGTH
                      ? "font-medium text-rose-500"
                      : descLength >= DESC_MAX_LENGTH * 0.9
                        ? "text-amber-500"
                        : "text-muted-foreground/70"
                  }`}
                >
                  {descLength.toLocaleString()} / {DESC_MAX_LENGTH.toLocaleString()}
                  {descLength >= DESC_MAX_LENGTH && " (limit reached)"}
                </div>
              )}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="border-t border-border/60 bg-muted/40 px-6 py-4">
            {/* Error */}
            {error && (
              <div
                className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="h-9 rounded-xl px-4 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground/85"
              >
                {tc("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit}
                className="h-9 min-w-[100px] rounded-xl bg-brand-emerald-600 px-5 text-[13px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-emerald-700 hover:shadow-md active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
              >
                {success ? (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Added
                  </span>
                ) : submitting ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Adding...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    Add Job
                  </span>
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
