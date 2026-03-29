import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

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

export function JobAddDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) setError(null);
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
        onOpenChange(false);
        setForm(EMPTY_FORM);
        queryClient.invalidateQueries({ queryKey: ["jobs"], refetchType: "active" });
        toast?.({ title: "Job added", description: undefined });
        return;
      }
      if (res.status === 409 && json.error === "JOB_URL_EXISTS") {
        setError("This job link already exists.");
        return;
      }
      setError(typeof json?.error === "string" ? json.error : "Failed to add job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add job</DialogTitle>
          <DialogDescription>Add a job from Seek or another site. Paste the job URL and fill in the details.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.jobUrl.trim() && form.title.trim() && !submitting) {
              handleSubmit();
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="add-job-url">Job URL *</Label>
            <Input
              id="add-job-url"
              type="url"
              placeholder="https://www.seek.com.au/job/..."
              value={form.jobUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, jobUrl: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-job-title">Title *</Label>
            <Input
              id="add-job-title"
              type="text"
              placeholder="e.g. Software Engineer"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-job-company">Company</Label>
            <Input
              id="add-job-company"
              type="text"
              placeholder="Company name"
              value={form.company}
              onChange={(e) => setForm((prev) => ({ ...prev, company: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Select
              value={form.location || ADD_JOB_EMPTY}
              onValueChange={(v) => setForm((prev) => ({ ...prev, location: v }))}
            >
              <SelectTrigger id="add-job-location">
                <SelectValue placeholder="Select location" />
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Job type</Label>
              <Select
                value={form.jobType || ADD_JOB_EMPTY}
                onValueChange={(v) => setForm((prev) => ({ ...prev, jobType: v }))}
              >
                <SelectTrigger id="add-job-type">
                  <SelectValue placeholder="Select type" />
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
            <div className="space-y-2">
              <Label>Job level</Label>
              <Select
                value={form.jobLevel || ADD_JOB_EMPTY}
                onValueChange={(v) => setForm((prev) => ({ ...prev, jobLevel: v }))}
              >
                <SelectTrigger id="add-job-level">
                  <SelectValue placeholder="Select level" />
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
          <div className="space-y-2">
            <Label htmlFor="add-job-description">Description</Label>
            <Textarea
              id="add-job-description"
              placeholder="Paste job description (optional)"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="min-h-[120px] max-h-[320px] resize-y overflow-y-auto"
            />
          </div>
          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!form.jobUrl.trim() || !form.title.trim() || submitting}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting ? "Adding..." : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
