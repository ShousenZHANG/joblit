"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import "react-day-picker/dist/style.css";
import { ChevronDown, Copy, Download, ExternalLink, FileText, MapPin, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useGuide } from "@/app/GuideContext";
import { useFetchStatus, type FetchRunStatus } from "@/app/FetchStatusContext";

import type { JobItem, JobStatus, CvSource, CoverSource, ResumeImportOutput, CoverImportOutput, ExternalPromptMeta } from "./types";
import { getErrorMessage } from "./types";
import { useJobFilters } from "./hooks/useJobFilters";
import { useJobPagination } from "./hooks/useJobPagination";
import { useJobMutations } from "./hooks/useJobMutations";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { JobListItem } from "./components/JobListItem";
import { VirtualJobList } from "./components/VirtualJobList";
import { JobDeleteDialog } from "./components/JobDeleteDialog";
import { JobAddDialog } from "./components/JobAddDialog";
import { JobSearchBar } from "./components/JobSearchBar";
import { cn } from "@/lib/utils";

const SKILL_PACK_META_STORAGE_KEY = "jobflow.skill-pack-meta.v1";

function isValidPromptMeta(value: unknown): value is ExternalPromptMeta {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ruleSetId === "string" &&
    record.ruleSetId.length > 0 &&
    typeof record.resumeSnapshotUpdatedAt === "string" &&
    record.resumeSnapshotUpdatedAt.length > 0 &&
    (record.promptTemplateVersion === undefined ||
      typeof record.promptTemplateVersion === "string") &&
    (record.schemaVersion === undefined || typeof record.schemaVersion === "string") &&
    (record.skillPackVersion === undefined || typeof record.skillPackVersion === "string") &&
    (record.promptHash === undefined || typeof record.promptHash === "string")
  );
}

function readSavedSkillPackMeta(): ExternalPromptMeta | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SKILL_PACK_META_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isValidPromptMeta(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSavedSkillPackMeta(meta: ExternalPromptMeta) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SKILL_PACK_META_STORAGE_KEY, JSON.stringify(meta));
}

function isSkillPackFresh(required: ExternalPromptMeta | null): boolean {
  if (!required) return false;
  const saved = readSavedSkillPackMeta();
  if (!saved) return false;
  if (required.skillPackVersion && saved.skillPackVersion) {
    return saved.skillPackVersion === required.skillPackVersion;
  }
  const baseMatches =
    saved.ruleSetId === required.ruleSetId &&
    saved.resumeSnapshotUpdatedAt === required.resumeSnapshotUpdatedAt;
  if (!baseMatches) return false;

  const templateMatches =
    !required.promptTemplateVersion || saved.promptTemplateVersion === required.promptTemplateVersion;
  const schemaMatches = !required.schemaVersion || saved.schemaVersion === required.schemaVersion;
  return templateMatches && schemaMatches;
}

const HIGHLIGHT_KEYWORDS = [
  "HTML", "CSS", "Sass", "SCSS", "Less", "JavaScript", "TypeScript", "React",
  "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "SvelteKit", "SolidJS", "Remix",
  "Node", "Node.js", "Express", "NestJS", "Fastify", "Deno", "Bun",
  "Python", "Django", "Flask", "FastAPI", "Java", "Spring", "Spring Boot",
  "Kotlin", "Scala", "C#", ".NET", "ASP.NET", "C++", "Go", "Golang", "Rust",
  "Ruby", "Rails", "PHP", "Laravel", "GraphQL", "REST", "gRPC", "tRPC",
  "SQL", "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Elasticsearch",
  "OpenSearch", "Kafka", "RabbitMQ", "SQS", "SNS", "AWS", "Azure", "GCP",
  "Firebase", "Cloudflare", "Docker", "Kubernetes", "Terraform", "Ansible",
  "Git", "GitHub Actions", "GitLab CI", "CI/CD", "Linux", "Nginx", "Vercel", "Netlify",
  "Jest", "Vitest", "Cypress", "Playwright", "Storybook", "Tailwind", "shadcn/ui",
  "Material UI", "Chakra UI", "Figma", "React Native", "Flutter", "Swift", "SwiftUI",
  "Android", "iOS", "ML", "AI", "LLM", "OpenAI", "LangChain", "Vector",
  "Pinecone", "Weaviate", "Snowflake", "Databricks", "Airflow", "dbt",
];

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

const CN_LOCATION_OPTIONS = [
  { value: "Beijing", label: "北京" },
  { value: "Shanghai", label: "上海" },
  { value: "Shenzhen", label: "深圳" },
  { value: "Guangzhou", label: "广州" },
  { value: "Hangzhou", label: "杭州" },
  { value: "Chengdu", label: "成都" },
  { value: "Nanjing", label: "南京" },
  { value: "Wuhan", label: "武汉" },
  { value: "Suzhou", label: "苏州" },
  { value: "Xi'an", label: "西安" },
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getUserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

type ExperienceRequirementSignal = {
  key: string;
  label: string;
  evidence: string;
  minYears: number;
  isRequired: boolean;
};

const EXPERIENCE_SOFT_RE = /\b(preferred|nice to have|nice-to-have|bonus|desired|a plus)\b/i;
const EXPERIENCE_HARD_RE =
  /\b(require|required|requirements|qualification|qualifications|minimum|at least|must have|must-have|must be)\b/i;
const EXPERIENCE_CONTEXT_RE =
  /\b(experience|exp|in (software|engineering|frontend|backend|full stack|development|devops|data|product|role|position|industry|field))\b/i;
const COMPANY_TENURE_RE =
  /\b(for|over|more than|around|about|nearly|almost|since)\b.*\b(company|startup|business|organisation|organization|team|firm|history|founded)\b/i;

function parseExperienceGate(description: string): ExperienceRequirementSignal[] {
  if (!description) return [];
  const normalized = description.replace(/\u2013|\u2014/g, "-").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const segments = normalized
    .split(/[\n.;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const output: ExperienceRequirementSignal[] = [];
  const seen = new Set<string>();

  const emit = (
    label: string,
    minYears: number,
    segment: string,
    isRequired: boolean,
  ) => {
    const key = `${label.toLowerCase()}|${isRequired ? "required" : "preferred"}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push({
      key,
      label: `${isRequired ? "Required" : "Preferred"}: ${label}`,
      evidence: segment,
      minYears,
      isRequired,
    });
  };

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (COMPANY_TENURE_RE.test(lower) && !EXPERIENCE_CONTEXT_RE.test(lower)) continue;

    const soft = EXPERIENCE_SOFT_RE.test(lower);
    const hard = EXPERIENCE_HARD_RE.test(lower);
    const hasExperienceContext = EXPERIENCE_CONTEXT_RE.test(lower);
    if (!hasExperienceContext && !hard && !soft) continue;

    let matched = false;

    const rangeMatch = segment.match(/\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b/i);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const minYears = Math.min(start, end);
        const maxYears = Math.max(start, end);
        emit(`${minYears}-${maxYears} years`, minYears, segment, hard && !soft);
        matched = true;
      }
    }

    const plusMatch = segment.match(/\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i);
    if (plusMatch) {
      const years = Number(plusMatch[1]);
      if (Number.isFinite(years)) {
        emit(`${years}+ years`, years, segment, hard && !soft);
        matched = true;
      }
    }

    if (!matched) {
      const plainMatch = segment.match(
        /\b(\d{1,2})\s*(?:years?|yrs?)\b(?:\s*(?:of|in))?\s*(?:\w+\s+){0,3}(?:experience|exp|role|position|industry|field)\b/i,
      );
      if (plainMatch) {
        const years = Number(plainMatch[1]);
        if (Number.isFinite(years)) {
          emit(`${years}+ years`, years, segment, hard && !soft);
        }
      }
    }
  }

  return output
    .sort((a, b) => {
      if (a.isRequired !== b.isRequired) return a.isRequired ? -1 : 1;
      return b.minYears - a.minYears;
    })
    .slice(0, 4);
}

export function JobsClient({
  initialItems = [],
  initialCursor = null,
}: {
  initialItems?: JobItem[];
  initialCursor?: string | null;
}) {
  const { toast } = useToast();
  const { isTaskHighlighted, markTaskComplete } = useGuide();
  const t = useTranslations("jobs");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const { runId: fetchRunId, status: fetchStatus, importedCount: fetchImportedCount } = useFetchStatus();
  const guideHighlightClass =
    "ring-2 ring-emerald-400 ring-offset-2 ring-offset-white shadow-[0_0_0_4px_rgba(16,185,129,0.18)]";
  const queryClient = useQueryClient();

  const {
    q, debouncedQ, setQ,
    statusFilter, setStatusFilter,
    locationFilter, setLocationFilter,
    jobLevelFilter, setJobLevelFilter,
    sortOrder, setSortOrder,
    market,
    queryString,
  } = useJobFilters();

  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [mobileTab, setMobileTab] = useState<"list" | "detail">("list");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [timeZone] = useState<string | null>(() => getUserTimeZone() || null);
  const [isPending, startTransition] = useTransition();
  const resultsScrollRef = useRef<HTMLDivElement | null>(null);
  const [suppressedDeletedIds, setSuppressedDeletedIds] = useState<Set<string>>(new Set());

  const {
    items, totalCount, nextCursor, loading, loadingInitial, loadingMore,
    loadedCursors, resetPagination, firstQueryError, jobLevelOptions,
  } = useJobPagination({
    queryString,
    initialItems,
    initialCursor: initialCursor ?? null,
    suppressedDeletedIds,
    scrollRef: resultsScrollRef,
  });

  const {
    updateStatus, deleteMutation,
    updatingIds, deletingIds,
    error: mutationError, setError,
  } = useJobMutations({
    items,
    selectedId,
    setSelectedId,
    setSuppressedDeletedIds,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{
    url: string;
    filename: string;
    label: string;
  } | null>(null);
  const [externalDialogOpen, setExternalDialogOpen] = useState(false);
  const [externalPromptLoading, setExternalPromptLoading] = useState(false);
  const [externalSkillPackLoading, setExternalSkillPackLoading] = useState(false);
  const [externalTarget, setExternalTarget] = useState<"resume" | "cover">("resume");
  const [externalPromptText, setExternalPromptText] = useState("");
  const [externalShortPromptText, setExternalShortPromptText] = useState("");
  const [externalModelOutput, setExternalModelOutput] = useState("");
  const [externalGenerating, setExternalGenerating] = useState(false);
  const [externalStep, setExternalStep] = useState<1 | 2 | 3>(1);
  const [externalPromptMeta, setExternalPromptMeta] = useState<ExternalPromptMeta | null>(null);
  const [externalSkillPackFresh, setExternalSkillPackFresh] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; title: string } | null>(null);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [tailorSourceByJob, setTailorSourceByJob] = useState<
    Record<string, { cv?: CvSource; cover?: CoverSource }>
  >({});
  const lastSeenImportRef = useRef<{
    runId: string | null;
    status: FetchRunStatus | null;
    importedCount: number;
  } | null>(null);
  const lastImportRefreshAtRef = useRef<number>(0);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (!appShell) return;
    appShell.classList.add("jobs-scroll-lock");
    return () => {
      appShell.classList.remove("jobs-scroll-lock");
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfPreview?.url) {
        URL.revokeObjectURL(pdfPreview.url);
      }
    };
  }, [pdfPreview?.url]);

  // Only dim/overlay during initial load or filter changes — not while appending more pages
  const showLoadingOverlay = (loading && !loadingMore) || isPending;
  const listOpacityClass = showLoadingOverlay ? "opacity-70" : "opacity-100";
  const queryError = firstQueryError
    ? getErrorMessage(firstQueryError, "Failed to load jobs")
    : null;
  const activeError = mutationError ?? queryError;

  const activeFilterCount = [
    locationFilter !== "ALL",
    jobLevelFilter !== "ALL",
    statusFilter !== "ALL",
    sortOrder !== "newest",
  ].filter(Boolean).length;

  function triggerSearch() {
    // Force-refresh on explicit submit (handles same-query re-submit to pick up new jobs)
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }

  useEffect(() => {
    const current = {
      runId: fetchRunId ?? null,
      status: (fetchStatus ?? null) as FetchRunStatus | null,
      importedCount: typeof fetchImportedCount === "number" ? fetchImportedCount : 0,
    };
    const previous = lastSeenImportRef.current;
    lastSeenImportRef.current = current;

    if (!current.runId || !current.status) return;
    if (!previous || previous.runId !== current.runId) return;

    const delta = current.importedCount - previous.importedCount;
    if (delta <= 0) return;

    const isTerminal = current.status === "SUCCEEDED" || current.status === "FAILED";
    const wasTerminal = previous.status === "SUCCEEDED" || previous.status === "FAILED";
    const justBecameTerminal = isTerminal && !wasTerminal;
    const isFirstPage = loadedCursors.length === 1 && loadedCursors[0] === null;
    const inProgress = current.status === "RUNNING" || current.status === "QUEUED";

    if (!justBecameTerminal && !(inProgress && isFirstPage)) return;

    if (!justBecameTerminal) {
      const now = Date.now();
      if (now - lastImportRefreshAtRef.current < 5000) return;
      lastImportRefreshAtRef.current = now;
    }

    resetPagination();
    queryClient.invalidateQueries({ queryKey: ["jobs"], refetchType: "active" });

    if (justBecameTerminal) {
      toast({
        title: "Jobs imported",
        description: `Imported ${delta} new job${delta === 1 ? "" : "s"}. Refreshing list.`,
        duration: 2200,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-900 animate-in fade-in zoom-in-95",
      });
    }
  }, [
    fetchImportedCount,
    fetchRunId,
    fetchStatus,
    loadedCursors,
    queryClient,
    resetPagination,
    toast,
  ]);

  function parseTailorOutput(
    raw: string,
    target: "resume" | "cover",
  ): ResumeImportOutput | CoverImportOutput | null {
    const source = raw.trim();
    if (!source) return null;

    const extractFirstJsonObject = (value: string): string | null => {
      let inString = false;
      let escaped = false;
      let depth = 0;
      let start = -1;
      for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (start < 0) {
          if (char === "{") {
            start = index;
            depth = 1;
            inString = false;
            escaped = false;
          }
          continue;
        }
        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (char === "\\") {
            escaped = true;
            continue;
          }
          if (char === '"') {
            inString = false;
          }
          continue;
        }
        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === "{") {
          depth += 1;
          continue;
        }
        if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            return value.slice(start, index + 1);
          }
        }
      }
      return null;
    };

    const parseCandidate = (candidate: string) => {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        return null;
      }
    };

    let parsed = parseCandidate(source);
    if (!parsed) {
      const repaired = source
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\u00A0/g, " ")
        .replace(/,\s*([}\]])/g, "$1");
      parsed = parseCandidate(repaired);
      if (!parsed) {
        const fenced = repaired.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
        if (fenced) parsed = parseCandidate(fenced.trim());
      }
      if (!parsed) {
        const firstObject = extractFirstJsonObject(repaired);
        if (firstObject) parsed = parseCandidate(firstObject);
      }
    }
    if (!parsed || typeof parsed !== "object") return null;

    const obj = parsed as Record<string, unknown>;
    if (target === "resume") {
      const cvSummary =
        typeof obj.cvSummary === "string"
          ? obj.cvSummary.trim()
          : typeof obj.summary === "string"
            ? obj.summary.trim()
            : "";
      const latestExperience =
        obj.latestExperience && typeof obj.latestExperience === "object"
          ? (obj.latestExperience as Record<string, unknown>)
          : null;
      const bullets =
        latestExperience && Array.isArray(latestExperience.bullets)
          ? latestExperience.bullets.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
          : [];
      if (!cvSummary || bullets.length === 0) return null;
      return { cvSummary };
    }

    const coverRoot =
      obj.cover && typeof obj.cover === "object"
        ? (obj.cover as Record<string, unknown>)
        : obj;
    const paragraphOne =
      typeof coverRoot.paragraphOne === "string"
        ? coverRoot.paragraphOne.trim()
        : typeof coverRoot.p1 === "string"
          ? coverRoot.p1.trim()
          : "";
    const paragraphTwo =
      typeof coverRoot.paragraphTwo === "string"
        ? coverRoot.paragraphTwo.trim()
        : typeof coverRoot.p2 === "string"
          ? coverRoot.p2.trim()
          : "";
    const paragraphThree =
      typeof coverRoot.paragraphThree === "string"
        ? coverRoot.paragraphThree.trim()
        : typeof coverRoot.p3 === "string"
          ? coverRoot.p3.trim()
          : "";

    if (!paragraphOne || !paragraphTwo || !paragraphThree) return null;

    return {
      cover: {
        subject: typeof coverRoot.subject === "string" ? coverRoot.subject.trim() : undefined,
        date: typeof coverRoot.date === "string" ? coverRoot.date.trim() : undefined,
        salutation:
          typeof coverRoot.salutation === "string" ? coverRoot.salutation.trim() : undefined,
        paragraphOne,
        paragraphTwo,
        paragraphThree,
        closing: typeof coverRoot.closing === "string" ? coverRoot.closing.trim() : undefined,
        signatureName:
          typeof coverRoot.signatureName === "string"
            ? coverRoot.signatureName.trim()
            : undefined,
      },
    };
  }

  function filenameFromDisposition(disposition: string | null) {
    if (!disposition) return null;
    const match = disposition.match(/filename="?([^"]+)"?/i);
    return match?.[1] ?? null;
  }

  function openPdfPreview(blob: Blob, filename: string, label: string) {
    const objectUrl = URL.createObjectURL(blob);
    setPdfPreview({ url: objectUrl, filename, label });
    setPreviewOpen(true);
  }

  async function loadTailorPrompt(job: JobItem, target: "resume" | "cover"): Promise<{
    promptText: string;
    shortPromptText: string;
    promptMeta: ExternalPromptMeta | null;
  }> {
    const res = await fetch("/api/applications/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, target }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.error?.message || json?.error || "Failed to build prompt");
    }
    const fullPromptText = [
      "You are given SYSTEM and USER instructions below. Follow them strictly. Output exactly one valid JSON object (no markdown or code fences).",
      "",
      "=== SYSTEM INSTRUCTIONS START ===",
      json.prompt?.systemPrompt ?? "",
      "=== SYSTEM INSTRUCTIONS END ===",
      "",
      "=== USER INSTRUCTIONS START ===",
      json.prompt?.userPrompt ?? "",
      "=== USER INSTRUCTIONS END ===",
    ].join("\n");
    const shortPromptText =
      typeof json.prompt?.shortUserPrompt === "string" && json.prompt.shortUserPrompt.trim().length > 0
        ? [
            "Follow your loaded jobflow-tailoring pack. Output exactly one JSON object (no markdown or code fences).",
            "",
            json.prompt.shortUserPrompt,
          ].join("\n")
        : fullPromptText;
    const promptText = fullPromptText;
    const promptMeta: ExternalPromptMeta | null =
      json?.promptMeta &&
      typeof json.promptMeta.ruleSetId === "string" &&
      typeof json.promptMeta.resumeSnapshotUpdatedAt === "string"
        ? {
            ruleSetId: json.promptMeta.ruleSetId,
            resumeSnapshotUpdatedAt: json.promptMeta.resumeSnapshotUpdatedAt,
            promptTemplateVersion:
              typeof json.promptMeta.promptTemplateVersion === "string"
                ? json.promptMeta.promptTemplateVersion
                : undefined,
            schemaVersion:
              typeof json.promptMeta.schemaVersion === "string"
                ? json.promptMeta.schemaVersion
                : undefined,
            skillPackVersion:
              typeof json.promptMeta.skillPackVersion === "string"
                ? json.promptMeta.skillPackVersion
                : undefined,
            promptHash: typeof json.promptMeta.promptHash === "string" ? json.promptMeta.promptHash : undefined,
          }
        : null;
    return { promptText, shortPromptText, promptMeta };
  }

  async function openExternalGenerateDialog(job: JobItem, target: "resume" | "cover") {
    setExternalDialogOpen(true);
    setExternalTarget(target);
    setExternalStep(1);
    setExternalModelOutput("");
    setExternalPromptText("");
    setExternalShortPromptText("");
    setExternalPromptMeta(null);
    setExternalSkillPackFresh(false);
    setError(null);
    setExternalPromptLoading(true);
    try {
      const { promptText, shortPromptText, promptMeta } = await loadTailorPrompt(job, target);
      setExternalPromptText(promptText);
      setExternalShortPromptText(shortPromptText);
      setExternalPromptMeta(promptMeta);
      const fresh = isSkillPackFresh(promptMeta);
      setExternalSkillPackFresh(fresh);
      setExternalStep(fresh ? 2 : 1);
    } catch (e) {
      const message = getErrorMessage(e, "Failed to initialize external AI flow");
      setError(message);
      toast({
        title: "Generate failed",
        description: message,
        variant: "destructive",
        duration: 2600,
        className:
          "border-rose-200 bg-rose-50 text-rose-900 animate-in fade-in zoom-in-95",
      });
    } finally {
      setExternalPromptLoading(false);
    }
  }

  async function copyPromptText() {
    if (!externalPromptText.trim()) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(externalPromptText);
      setExternalStep(3);
      toast({
        title: "Prompt copied",
        description: "Paste it into ChatGPT/Gemini/Claude and return JSON here.",
        duration: 2200,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-900 animate-in fade-in zoom-in-95",
      });
      return;
    }
    const blob = new Blob([externalPromptText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jobflow-tailor-prompt.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Prompt ready",
      description: "Clipboard unavailable. Prompt text downloaded as a file.",
      duration: 2200,
      className: "border-slate-200 bg-slate-50 text-slate-900 animate-in fade-in zoom-in-95",
    });
  }

  async function copyShortPromptText() {
    const text = externalShortPromptText.trim();
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setExternalStep(3);
      toast({
        title: "Short prompt copied",
        description: "Paste into a chat that already has the skill pack loaded.",
        duration: 2200,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-900 animate-in fade-in zoom-in-95",
      });
      return;
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jobflow-tailor-prompt-short.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Short prompt ready",
      description: "Clipboard unavailable. File downloaded.",
      duration: 2200,
      className: "border-slate-200 bg-slate-50 text-slate-900 animate-in fade-in zoom-in-95",
    });
  }

  async function downloadSkillPack() {
    if (externalPromptLoading || !externalPromptMeta) {
      return;
    }
    setExternalSkillPackLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prompt-rules/skill-pack", { cache: "no-store" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || json?.error || "Failed to download skill pack");
      }
      const blob = await res.blob();
      const fallbackName = "jobflow-tailoring.tar.gz";
      const filename = filenameFromDisposition(res.headers.get("content-disposition")) || fallbackName;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      if (externalPromptMeta) {
        writeSavedSkillPackMeta(externalPromptMeta);
        setExternalSkillPackFresh(true);
        setExternalStep(2);
      }
      toast({
        title: "Skill pack downloaded",
        description: "Skill pack marked as up-to-date for current prompt.",
        duration: 2200,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-900 animate-in fade-in zoom-in-95",
      });
    } catch (e) {
      const message = getErrorMessage(e, "Failed to download skill pack");
      setError(message);
      toast({
        title: "Download failed",
        description: message,
        variant: "destructive",
        duration: 2600,
        className:
          "border-rose-200 bg-rose-50 text-rose-900 animate-in fade-in zoom-in-95",
      });
    } finally {
      setExternalSkillPackLoading(false);
    }
  }

  async function generateFromImportedJson(job: JobItem, target: "resume" | "cover", modelOutput: string) {
    setExternalGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/applications/manual-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          target,
          modelOutput,
          promptMeta: externalPromptMeta,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const baseMessage = json?.error?.message || json?.error || "Failed to generate PDF";
        const details = Array.isArray(json?.error?.details)
          ? json.error.details.filter((item: unknown) => typeof item === "string")
          : [];
        const detailText = details.length ? ` (${details.slice(0, 2).join(" | ")})` : "";
        throw new Error(`${baseMessage}${detailText}`);
      }

      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get("content-disposition")) ||
        (target === "resume" ? "resume.pdf" : "cover-letter.pdf");
      openPdfPreview(blob, filename, target === "resume" ? "Resume preview" : "Cover letter preview");
      markTaskComplete("generate_first_pdf");

      if (target === "resume") {
        setTailorSourceByJob((prev) => ({
          ...prev,
          [job.id]: { ...prev[job.id], cv: "manual_import" },
        }));
      } else {
        setTailorSourceByJob((prev) => ({
          ...prev,
          [job.id]: { ...prev[job.id], cover: "manual_import" },
        }));
      }

      setExternalDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["jobs"], refetchType: "active" });
      toast({
        title: "PDF generated",
        description:
          target === "resume"
            ? "CV generated from imported AI JSON."
            : "Cover letter generated from imported AI JSON.",
        duration: 2200,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-900 animate-in fade-in zoom-in-95",
      });
    } catch (e) {
      const message = getErrorMessage(e, "Failed to generate PDF");
      setError(message);
      toast({
        title: "Import failed",
        description: message,
        variant: "destructive",
        duration: 2600,
        className:
          "border-rose-200 bg-rose-50 text-rose-900 animate-in fade-in zoom-in-95",
      });
    } finally {
      setExternalGenerating(false);
    }
  }

  function scheduleDelete(job: JobItem) {
    if (deletingIds.has(job.id)) return;
    setDeleteCandidate({ id: job.id, title: job.title });
    setDeleteConfirmOpen(true);
  }

  function confirmDeleteCandidate() {
    if (!deleteCandidate) return;
    deleteMutation.mutate(deleteCandidate.id);
    setDeleteConfirmOpen(false);
    setDeleteCandidate(null);
  }

  const statusClass: Record<JobStatus, string> = {
    NEW: "bg-emerald-100 text-emerald-700",
    APPLIED: "bg-sky-100 text-sky-700",
    REJECTED: "bg-slate-200 text-slate-600",
  };
  const statusLabel: Record<JobStatus, string> = {
    NEW: "New",
    APPLIED: "Applied",
    REJECTED: "Rejected",
  };

  const effectiveSelectedId = useMemo(() => {
    if (!items.length) return null;
    if (selectedId && items.some((it) => it.id === selectedId)) return selectedId;
    return items[0]?.id ?? null;
  }, [items, selectedId]);

  const handleSelectJob = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id !== null && typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileTab("detail");
    }
  }, []);

  useKeyboardNavigation({
    items,
    selectedId: effectiveSelectedId,
    onSelect: handleSelectJob,
  });

  const selectedJob = items.find((it) => it.id === effectiveSelectedId) ?? null;
  const selectedTailorSource = selectedJob ? tailorSourceByJob[selectedJob.id] : undefined;
  const isAppliedSelected = selectedJob?.status === "APPLIED";
  const highlightGenerate = isTaskHighlighted("generate_first_pdf");
  const parsedExternalOutput = useMemo(
    () => parseTailorOutput(externalModelOutput, externalTarget),
    [externalModelOutput, externalTarget],
  );
  const canOpenStep2 = externalSkillPackFresh;
  const canOpenStep3 = externalPromptText.trim().length > 0;
  const externalSteps = useMemo(
    () =>
      [
        { id: 1 as const, label: "Skill Pack", disabled: false },
        { id: 2 as const, label: "Copy Prompt", disabled: !canOpenStep2 },
        { id: 3 as const, label: "Paste JSON", disabled: !canOpenStep3 },
      ] satisfies Array<{ id: 1 | 2 | 3; label: string; disabled: boolean }>,
    [canOpenStep2, canOpenStep3],
  );
  const externalBtnSecondary =
    "h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none";
  const externalBtnPrimary =
    "h-10 rounded-xl border border-emerald-500 bg-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-emerald-600 hover:border-emerald-600 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none";
  const detailsScrollRef = useRef<HTMLDivElement | null>(null);
  const detailQuery = useQuery({
    queryKey: ["job-details", effectiveSelectedId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${effectiveSelectedId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load details");
      return json as { id: string; description: string | null };
    },
    enabled: Boolean(effectiveSelectedId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const selectedDescription = selectedJob ? detailQuery.data?.description ?? "" : "";
  const detailError = detailQuery.error
    ? getErrorMessage(detailQuery.error, "Failed to load details")
    : null;
  const detailLoading = detailQuery.isFetching && !detailQuery.data;
  const experienceSignals = useMemo(
    () => parseExperienceGate(selectedDescription),
    [selectedDescription],
  );
  const highlightRegex = useMemo(() => {
    const patterns = HIGHLIGHT_KEYWORDS.map((keyword) => {
      const escaped = escapeRegExp(keyword);
      const isPlainWord = /^[a-z0-9.+#-]+$/i.test(keyword);
      return isPlainWord ? `\\b${escaped}\\b` : escaped;
    });
    return new RegExp(`(${patterns.join("|")})`, "i");
  }, []);

  const markdownStyles = useMemo(
    () => ({
      heading: "text-base font-semibold text-slate-900",
      subheading: "text-sm font-semibold text-slate-900",
      paragraph: "text-sm leading-7 text-slate-700",
      list: "list-disc space-y-1 pl-5 text-sm text-slate-700",
      listOrdered: "list-decimal space-y-1 pl-5 text-sm text-slate-700",
      listItem: "text-sm leading-7 text-slate-700",
      blockquote: "border-l-2 border-slate-200 bg-slate-50/60 px-4 py-2 text-sm text-slate-700",
      codeInline: "rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800",
      pre: "rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 overflow-auto",
      link: "text-emerald-700 underline-offset-4 hover:underline",
      table: "w-full border-collapse text-sm",
      th: "border border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-900",
      td: "border border-slate-200 px-3 py-2 text-slate-700",
    }),
    [],
  );

  function highlightText(text: string) {
    const parts = text.split(highlightRegex);
    return parts.map((part, index) => {
      if (highlightRegex.test(part)) {
        return (
          <mark
            key={`${part}-${index}`}
            className="rounded-sm bg-amber-100/90 px-1 py-0.5 font-medium text-amber-900"
          >
            {part}
          </mark>
        );
      }
      return <span key={`${part}-${index}`}>{part}</span>;
    });
  }

  function renderHighlighted(children: React.ReactNode): React.ReactNode {
    if (typeof children === "string") return highlightText(children);
    if (Array.isArray(children)) {
      return children.map((child, index) => (
        <span key={index}>{renderHighlighted(child)}</span>
      ));
    }
    return children;
  }

  return (
    <>
      <Dialog open={externalDialogOpen} onOpenChange={setExternalDialogOpen}>
        <DialogContent className="flex h-[min(88vh,760px)] w-[min(96vw,860px)] max-w-[860px] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {externalTarget === "resume" ? "Generate CV with External AI" : "Generate Cover Letter with External AI"}
            </DialogTitle>
            <DialogDescription>
              Complete three steps, then generate your PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <div className="relative flex items-center justify-between gap-2">
                <div className="pointer-events-none absolute left-8 right-8 top-4 h-px bg-slate-200" />
                {externalSteps.map((step) => {
                  const isActive = externalStep === step.id;
                  const isDone = externalStep > step.id;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => !step.disabled && setExternalStep(step.id)}
                      disabled={step.disabled}
                      className={[
                        "relative z-10 flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-200 sm:text-sm",
                        step.disabled ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-50",
                        isActive ? "bg-emerald-50 text-emerald-800" : "",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                          isDone
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : isActive
                              ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                              : "border-slate-300 bg-white text-slate-500",
                        ].join(" ")}
                      >
                        {step.id}
                      </span>
                      <span className="truncate">{step.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-900/10 bg-slate-50/40 p-4">
              {externalStep === 1 ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-700">
                    {externalSkillPackFresh
                      ? "Your skill pack is up to date. You can skip to Step 2."
                      : "Download the latest skill pack before generating content."}
                  </p>
                  {!externalSkillPackFresh ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Required: latest rules and resume snapshot.
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        !selectedJob ||
                        externalSkillPackLoading ||
                        externalPromptLoading ||
                        !externalPromptMeta
                      }
                      onClick={() => selectedJob && downloadSkillPack()}
                      className={externalBtnSecondary}
                    >
                      {externalSkillPackLoading
                        ? "Downloading..."
                        : externalPromptLoading
                          ? "Preparing..."
                        : externalSkillPackFresh
                          ? "Re-download Skill Pack"
                          : "Download Skill Pack"}
                    </Button>
                    {externalSkillPackFresh ? (
                      <Button type="button" size="sm" onClick={() => setExternalStep(2)} className={externalBtnPrimary}>
                        Continue
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {externalStep === 2 ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-700">
                    Copy prompt and paste it in ChatGPT/Gemini/Claude with your imported skill pack.
                  </p>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                    Full prompt: {externalPromptText.length} chars · Short (pack loaded): {externalShortPromptText.length} chars
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={externalPromptLoading || !externalPromptText.trim()}
                      onClick={copyPromptText}
                      className={externalBtnSecondary}
                    >
                      <Copy className="h-4 w-4" />
                      {externalPromptLoading ? "Building..." : "Copy full prompt"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={externalPromptLoading || !externalShortPromptText.trim()}
                      onClick={copyShortPromptText}
                      className={externalBtnSecondary}
                      title="Use when the model already has the skill pack in context"
                    >
                      <Copy className="h-4 w-4" />
                      Copy short (pack loaded)
                    </Button>
                    <Button type="button" size="sm" onClick={() => setExternalStep(3)} className={externalBtnPrimary}>
                      Continue
                    </Button>
                  </div>
                </div>
              ) : null}

              {externalStep === 3 ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-slate-900">Paste AI JSON result</div>
                  <Textarea
                    value={externalModelOutput}
                    onChange={(e) => setExternalModelOutput(e.target.value)}
                    placeholder={
                      externalTarget === "resume"
                        ? '{"cvSummary":"...","latestExperience":{"bullets":["..."]},"skillsFinal":[{"label":"...","items":["..."]}]}'
                        : '{"cover":{"candidateTitle":"...","subject":"Application for <Role>","date":"...","salutation":"Hiring Team at <Company>","paragraphOne":"...","paragraphTwo":"...","paragraphThree":"...","closing":"...","signatureName":"..."}}'
                    }
                    className="min-h-[220px] font-mono text-xs"
                  />
                  {!externalModelOutput.trim() ? null : parsedExternalOutput ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900">
                      JSON parsed successfully.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-xs text-rose-900">
                      JSON parse failed. Keep strict JSON with required keys.
                    </div>
                  )}

                </div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {externalStep > 1 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExternalStep((prev) => (prev === 3 ? 2 : 1))}
                disabled={externalGenerating}
                className={externalBtnSecondary}
              >
                Back
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExternalDialogOpen(false)}
              disabled={externalGenerating}
              className={externalBtnSecondary}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className={externalBtnPrimary}
              disabled={
                !selectedJob ||
                externalGenerating ||
                externalStep !== 3 ||
                !parsedExternalOutput ||
                externalModelOutput.trim().length < 20
              }
              data-guide-anchor={externalTarget === "resume" ? "generate_first_pdf" : undefined}
              onClick={() =>
                selectedJob &&
                generateFromImportedJson(selectedJob, externalTarget, externalModelOutput)
              }
            >
              {externalGenerating
                ? "Generating..."
                : externalTarget === "resume"
                  ? "Generate CV PDF"
                  : "Generate Cover PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <JobAddDialog open={addJobOpen} onOpenChange={setAddJobOpen} />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="h-[92vh] w-[98vw] max-w-[min(98vw,1280px)] overflow-hidden p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{pdfPreview?.label ?? "PDF preview"}</DialogTitle>
            <DialogDescription>Preview the generated PDF.</DialogDescription>
          </DialogHeader>
          <div className="flex h-full flex-col">
            <div className="flex h-11 items-center justify-between border-b border-slate-900/10 bg-white/90 px-3">
              <div className="text-xs font-medium text-slate-600">
                {pdfPreview?.label ?? "PDF preview"}
              </div>
              <div className="flex items-center gap-2">
                {pdfPreview ? (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-xl border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px]"
                  >
                    <a href={pdfPreview.url} download={pdfPreview.filename}>
                      <Download className="mr-1.5 h-4 w-4" />
                      Download PDF
                    </a>
                  </Button>
                ) : null}
                <DialogClose asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-xl border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px]"
                  >
                    Close
                  </Button>
                </DialogClose>
              </div>
            </div>
            <div className="flex-1 bg-white">
              {pdfPreview ? (
                <iframe
                  title={pdfPreview.label}
                  src={pdfPreview.url}
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No preview available.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div
        data-testid="jobs-shell"
        className="edu-page-enter relative flex flex-1 flex-col gap-2 pb-0 text-foreground lg:min-h-0 lg:h-full lg:overflow-hidden"
      >
      <div className="flex flex-1 flex-col gap-2 lg:min-h-0 lg:h-full lg:overflow-hidden">
        <div aria-live="polite" className="sr-only">
          {totalCount !== undefined ? `${totalCount} jobs found` : "Loading jobs"}
        </div>
        <div
        role="search"
        aria-label="Job search"
        data-testid="jobs-toolbar"
        className="relative rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur lg:rounded-3xl lg:border-2 lg:border-slate-900/10 lg:bg-white/80 lg:p-5 lg:shadow-[0_20px_45px_-35px_rgba(15,23,42,0.35)]"
      >
        {loading ? (
          <div className="absolute top-0 left-0 right-0 z-10 h-0.5 overflow-hidden rounded-t-2xl lg:rounded-t-3xl">
            <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
          </div>
        ) : null}

        {/* Mobile: compact search + filter toggle */}
        <div className="flex flex-col gap-2 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <JobSearchBar
                q={q}
                onQueryChange={setQ}
                onSubmit={triggerSearch}
                placeholder={t("placeholder")}
                isDebouncing={q !== "" && q !== debouncedQ}
              />
            </div>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                mobileFiltersOpen
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-600",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {activeFilterCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <Button
              onClick={triggerSearch}
              disabled={loading}
              size="sm"
              className="h-9 shrink-0 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 active:scale-[0.97]"
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          </div>

          {mobileFiltersOpen && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
              <Select
                value={locationFilter}
                onValueChange={(v) => { startTransition(() => { setLocationFilter(v); }); }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <MapPin className="mr-1 h-3 w-3 shrink-0 text-slate-400" />
                  <SelectValue placeholder={tc("allLocations")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tc("allLocations")}</SelectItem>
                  {(market === "CN" ? CN_LOCATION_OPTIONS : AU_LOCATION_OPTIONS).map((loc) => (
                    <SelectItem key={loc.value} value={loc.value}>{loc.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={jobLevelFilter}
                onValueChange={(v) => { startTransition(() => { setJobLevelFilter(v); }); }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={tc("allLevels")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tc("allLevels")}</SelectItem>
                  {jobLevelOptions.map((level) => (
                    <SelectItem key={level} value={level}>{level}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(v) => { startTransition(() => { setStatusFilter(v as JobStatus | "ALL"); }); }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={tc("all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tc("all")}</SelectItem>
                  <SelectItem value="NEW">{t("statusNew")}</SelectItem>
                  <SelectItem value="APPLIED">{t("statusApplied")}</SelectItem>
                  <SelectItem value="REJECTED">{t("statusRejected")}</SelectItem>
                </SelectContent>
              </Select>
              <div data-testid="jobs-sort">
                <Select
                  value={sortOrder}
                  onValueChange={(v) => { startTransition(() => { setSortOrder(v as "newest" | "oldest"); }); }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={t("posted")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{t("newestFirst")}</SelectItem>
                    <SelectItem value="oldest">{t("oldestFirst")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {market === "AU" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddJobOpen(true)}
                  className="col-span-2 h-8 text-xs"
                >
                  Add job
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Desktop: full horizontal toolbar */}
        <div className="hidden lg:grid lg:grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.9fr_auto] lg:items-end lg:gap-4">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("titleOrKeywords")}</div>
            <JobSearchBar
              q={q}
              onQueryChange={setQ}
              onSubmit={triggerSearch}
              placeholder={t("placeholder")}
              isDebouncing={q !== "" && q !== debouncedQ}
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("location")}</div>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Select
                value={locationFilter}
                onValueChange={(v) => { startTransition(() => { setLocationFilter(v); }); }}
              >
                <SelectTrigger className="pl-9">
                  <SelectValue placeholder={tc("allLocations")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tc("allLocations")}</SelectItem>
                  {(market === "CN" ? CN_LOCATION_OPTIONS : AU_LOCATION_OPTIONS).map((loc) => (
                    <SelectItem key={loc.value} value={loc.value}>{loc.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("jobLevel")}</div>
            <Select
              value={jobLevelFilter}
              onValueChange={(v) => { startTransition(() => { setJobLevelFilter(v); }); }}
            >
              <SelectTrigger>
                <SelectValue placeholder={tc("allLevels")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{tc("allLevels")}</SelectItem>
                {jobLevelOptions.map((level) => (
                  <SelectItem key={level} value={level}>{level}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("status")}</div>
            <Select
              value={statusFilter}
              onValueChange={(v) => { startTransition(() => { setStatusFilter(v as JobStatus | "ALL"); }); }}
            >
              <SelectTrigger>
                <SelectValue placeholder={tc("all")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{tc("all")}</SelectItem>
                <SelectItem value="NEW">{t("statusNew")}</SelectItem>
                <SelectItem value="APPLIED">{t("statusApplied")}</SelectItem>
                <SelectItem value="REJECTED">{t("statusRejected")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2" data-testid="jobs-sort">
            <div className="text-xs text-muted-foreground">{t("posted")}</div>
            <Select
              value={sortOrder}
              onValueChange={(v) => { startTransition(() => { setSortOrder(v as "newest" | "oldest"); }); }}
            >
              <SelectTrigger className="h-9 bg-muted/40">
                <SelectValue placeholder={t("posted")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t("newestFirst")}</SelectItem>
                <SelectItem value="oldest">{t("oldestFirst")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            {market === "AU" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddJobOpen(true)}
                className="h-10 rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:w-auto"
              >
                Add job
              </Button>
            )}
            <Button
              onClick={triggerSearch}
              disabled={loading}
              className="h-10 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg hover:brightness-105 active:scale-[0.97] disabled:opacity-50 lg:w-auto"
            >
              <Search className="mr-1.5 h-4 w-4" />
              {tc("search")}
            </Button>
          </div>
        </div>
      </div>

      {activeError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {activeError}
        </div>
      ) : null}

        <section className="relative flex flex-1 flex-col gap-3 lg:grid lg:min-h-0 lg:h-full lg:grid-cols-[380px_1fr] lg:items-stretch">
        <div
          className="flex shrink-0 items-center rounded-lg bg-slate-100/80 p-0.5 lg:hidden"
          role="tablist"
          aria-label={t("mobileTablistLabel")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "list"}
            onClick={() => setMobileTab("list")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150",
              mobileTab === "list"
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-slate-500 active:bg-white/60",
            )}
          >
            {tn("jobs")}
            <span className="ml-1 text-[10px] font-normal opacity-70">
              {typeof totalCount === "number" ? totalCount : items.length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "detail"}
            onClick={() => setMobileTab("detail")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150",
              mobileTab === "detail"
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-slate-500 active:bg-white/60",
            )}
          >
            {t("tabDetail")}
          </button>
        </div>

        <div
          data-testid="jobs-results-panel"
          className={cn(
            "relative flex flex-col overflow-hidden backdrop-blur transition-shadow duration-200 ease-out",
            "rounded-2xl border border-slate-200 bg-white/95 shadow-sm",
            "lg:rounded-3xl lg:border-2 lg:border-slate-900/10 lg:bg-white/80 lg:shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] lg:hover:shadow-[0_24px_50px_-36px_rgba(15,23,42,0.38)]",
            "h-[calc(100dvh-240px)] lg:h-auto lg:min-h-0 lg:flex-1",
            mobileTab !== "list" && "hidden lg:flex",
          )}
        >
          <div className="flex items-center justify-between border-b px-4 py-3 text-sm font-semibold">
            <span>
              {t("results")}
              {typeof totalCount === "number" ? (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  · {totalCount} {totalCount === 1 ? "job" : "jobs"}
                </span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">{items.length} loaded</span>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
          <ScrollArea
            ref={resultsScrollRef}
            type="always"
            data-testid="jobs-results-scroll"
            data-loading={showLoadingOverlay ? "true" : "false"}
            data-virtual={items.length > 80 ? "true" : "false"}
            className={`jobs-scroll-area max-h-full flex-1 min-h-0 transition-opacity duration-200 ease-out ${listOpacityClass}`}
          >
            {loadingInitial ? (
              <div className="space-y-3 p-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={`s-${idx}`} className="rounded-lg border p-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="mt-2 h-3 w-1/2" />
                    <Skeleton className="mt-2 h-3 w-1/3" />
                  </div>
                ))}
              </div>
            ) : null}
            {items.length > 0 ? (
              items.length > 80 ? (
                <VirtualJobList
                  items={items}
                  effectiveSelectedId={effectiveSelectedId}
                  onSelect={setSelectedId}
                  timeZone={timeZone}
                  scrollRootRef={resultsScrollRef}
                />
              ) : (
                <div className="space-y-3 p-3">
                  {items.map((it) => (
                    <JobListItem
                      key={it.id}
                      job={it}
                      isActive={it.id === effectiveSelectedId}
                      onSelect={() => handleSelectJob(it.id)}
                      timeZone={timeZone}
                    />
                  ))}
                </div>
              )
            ) : !loading ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("noJobs")}
              </div>
            ) : null}
          </ScrollArea>
          </div>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            {loadingMore ? (
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                <span>Loading more jobs…</span>
              </div>
            ) : nextCursor ? (
              "Scroll down to load more"
            ) : (
              "End of results"
            )}
          </div>
        </div>

        <div
          data-testid="jobs-details-panel"
          className={cn(
            "relative flex flex-col overflow-hidden backdrop-blur transition-shadow duration-200 ease-out",
            "rounded-2xl border border-slate-200 bg-white/95 shadow-sm",
            "lg:rounded-3xl lg:border-2 lg:border-slate-900/10 lg:bg-white/80 lg:shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] lg:hover:shadow-[0_24px_50px_-36px_rgba(15,23,42,0.38)]",
            "h-[calc(100dvh-240px)] lg:h-auto lg:min-h-0 lg:flex-1",
            mobileTab !== "detail" && "hidden lg:flex",
          )}
        >
          <div className="border-b px-4 py-3">
            {selectedJob ? (
              <div className="relative flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{selectedJob.title}</h2>
                    <Badge className={statusClass[selectedJob.status]}>{selectedJob.status}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {selectedJob.company ?? "-"} · {selectedJob.location ?? "-"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selectedJob.jobType ?? "Unknown"} · {selectedJob.jobLevel ?? "Unknown"}
                  </div>
                </div>
                <div className="w-full lg:w-auto">
                  <div
                    data-testid="job-primary-actions"
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center"
                  >
                    <Select
                      value={selectedJob.status}
                      onValueChange={(v) => updateStatus(selectedJob.id, v as JobStatus)}
                      disabled={updatingIds.has(selectedJob.id)}
                    >
                      <SelectTrigger
                        className={`rounded-xl border-slate-200 bg-white shadow-sm ${
                          isAppliedSelected ? "h-9 w-full px-3 text-sm sm:w-[118px]" : "h-10 w-full sm:w-[132px]"
                        }`}
                      >
                        <span className="truncate">{statusLabel[selectedJob.status]}</span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NEW">New</SelectItem>
                        <SelectItem value="APPLIED">Applied</SelectItem>
                        <SelectItem value="REJECTED">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      asChild
                      size="sm"
                      className={`w-full justify-center rounded-xl border border-emerald-500 bg-emerald-500 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-emerald-600 hover:bg-emerald-600 active:translate-y-[1px] sm:w-auto ${
                        isAppliedSelected ? "h-9 px-3.5" : "h-10 px-4"
                      }`}
                    >
                      <a href={selectedJob.jobUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-1 h-4 w-4" />
                        Open job
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={externalPromptLoading}
                      onClick={() => openExternalGenerateDialog(selectedJob, "resume")}
                      className={`w-full justify-center rounded-xl border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none sm:w-auto ${
                        isAppliedSelected ? "h-9 px-3.5" : "h-10 px-4"
                      } ${highlightGenerate ? guideHighlightClass : ""}`}
                      data-guide-highlight={highlightGenerate ? "true" : "false"}
                      data-guide-anchor="generate_first_pdf"
                    >
                      <FileText className="mr-1 h-4 w-4" />
                      Generate CV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={externalPromptLoading}
                      onClick={() => openExternalGenerateDialog(selectedJob, "cover")}
                      className={`w-full justify-center rounded-xl border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none sm:w-auto ${
                        isAppliedSelected ? "h-9 px-3.5" : "h-10 px-4"
                      } ${highlightGenerate ? guideHighlightClass : ""}`}
                      data-guide-highlight={highlightGenerate ? "true" : "false"}
                    >
                      <FileText className="mr-1 h-4 w-4" />
                      Generate CL
                    </Button>
                    {selectedJob.resumePdfUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className={`w-full justify-center rounded-xl border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px] sm:w-auto ${
                          isAppliedSelected ? "h-9 px-3.5" : "h-10 px-4"
                        }`}
                      >
                        <a href={selectedJob.resumePdfUrl} target="_blank" rel="noreferrer">
                          Saved CV
                        </a>
                      </Button>
                    ) : null}
                    {selectedJob.coverPdfUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className={`w-full justify-center rounded-xl border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px] sm:w-auto ${
                          isAppliedSelected ? "h-9 px-3.5" : "h-10 px-4"
                        }`}
                      >
                        <a href={selectedJob.coverPdfUrl} target="_blank" rel="noreferrer">
                          Saved CL
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      data-testid="job-remove-button"
                      variant="outline"
                      size="sm"
                      disabled={deletingIds.has(selectedJob.id)}
                      onClick={() => scheduleDelete(selectedJob)}
                      className={`w-full justify-center rounded-xl border-rose-200 bg-rose-50 text-sm font-medium text-rose-700 shadow-sm transition-all duration-200 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800 active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none sm:ml-auto sm:w-auto ${
                        isAppliedSelected ? "h-9 px-3.5" : "h-10 px-4"
                      }`}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                </div>
                {selectedTailorSource ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {selectedTailorSource.cv ? (
                      <span className="rounded-full border border-slate-900/10 bg-slate-100/70 px-2 py-0.5">
                        CV: {selectedTailorSource.cv === "ai" ? "AI" : selectedTailorSource.cv === "manual_import" ? "Manual" : "Base"}
                      </span>
                    ) : null}
                    {selectedTailorSource.cover ? (
                      <span className="rounded-full border border-slate-900/10 bg-slate-100/70 px-2 py-0.5">
                        Cover: {selectedTailorSource.cover === "ai" ? "AI" : selectedTailorSource.cover === "manual_import" ? "Manual" : "Fallback"}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Select a job to preview details.</div>
            )}
          </div>
          <ScrollArea
            type="always"
            data-testid="jobs-details-scroll"
            data-loading={showLoadingOverlay ? "true" : "false"}
            className={`jobs-scroll-area max-h-full flex-1 min-h-0 transition-opacity duration-200 ease-out ${listOpacityClass}`}
          >
            <div key={effectiveSelectedId ?? "empty"} ref={detailsScrollRef} className="p-4">
            {selectedJob ? (
              <div className="space-y-4 text-sm text-muted-foreground">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Job Description
                </div>
                {experienceSignals.length ? (
                  <div className="rounded-xl border border-slate-900/10 bg-slate-50/70 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                      Experience gate
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {experienceSignals.map((signal) => (
                        <span
                          key={signal.key}
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                            signal.isRequired
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : "border-amber-200 bg-amber-50 text-amber-800"
                          }`}
                          title={signal.evidence}
                        >
                          {signal.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailError ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {detailError}
                  </div>
                ) : null}
                {detailLoading ? (
                  <div className="space-y-3 rounded-lg border border-dashed border-slate-900/10 bg-transparent p-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-900/10 bg-transparent p-5">
                    {selectedDescription ? (
                      <div className="space-y-3">
                        <div className="space-y-4">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeHighlight]}
                            components={{
                              h2: ({ children }) => (
                                <h2 className={markdownStyles.heading}>{renderHighlighted(children)}</h2>
                              ),
                              h3: ({ children }) => (
                                <h3 className={markdownStyles.subheading}>{renderHighlighted(children)}</h3>
                              ),
                              p: ({ children }) => (
                                <p className={markdownStyles.paragraph}>
                                  {renderHighlighted(children)}
                                </p>
                              ),
                              ul: ({ children }) => (
                                <ul className={markdownStyles.list}>{children}</ul>
                              ),
                              ol: ({ children }) => (
                                <ol className={markdownStyles.listOrdered}>{children}</ol>
                              ),
                              li: ({ children }) => (
                                <li className={markdownStyles.listItem}>
                                  {renderHighlighted(children)}
                                </li>
                              ),
                              blockquote: ({ children }) => (
                                <blockquote className={markdownStyles.blockquote}>{children}</blockquote>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold text-slate-900">
                                  {renderHighlighted(children)}
                                </strong>
                              ),
                              a: ({ href, children }) => (
                                <a href={href} className={markdownStyles.link} target="_blank" rel="noreferrer">
                                  {children}
                                </a>
                              ),
                              pre: ({ children }) => <pre className={markdownStyles.pre}>{children}</pre>,
                              code: ({ className, children }) => {
                                const isInline = !className;
                                return isInline ? (
                                  <code className={markdownStyles.codeInline}>{children}</code>
                                ) : (
                                  <code className={className}>{children}</code>
                                );
                              },
                              table: ({ children }) => (
                                <table className={markdownStyles.table}>{children}</table>
                              ),
                              th: ({ children }) => <th className={markdownStyles.th}>{children}</th>,
                              td: ({ children }) => <td className={markdownStyles.td}>{children}</td>,
                            }}
                          >
                            {selectedDescription}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No description available for this job yet.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Use the list on the left to choose a job.
              </div>
            )}
            </div>
          </ScrollArea>
        </div>
        </section>
      </div>
      </div>
      <JobDeleteDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setDeleteCandidate(null);
        }}
        candidate={deleteCandidate}
        onConfirm={confirmDeleteCandidate}
      />
    </>
  );
}
