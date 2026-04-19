"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ExternalLink, FileText, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { JobItem, JobStatus, CvSource, CoverSource } from "../types";
import { HIGHLIGHT_KEYWORDS, escapeRegExp } from "../utils/constants";
import { parseExperienceGate } from "../utils/experienceParser";
import { MatchScoreCard } from "./MatchScoreCard";

const statusClass: Record<JobStatus, string> = {
  NEW: "bg-brand-emerald-100 text-brand-emerald-700",
  APPLIED: "bg-[theme(colors.tier-good-bg)] text-[theme(colors.tier-good-fg)]",
  REJECTED: "bg-muted text-muted-foreground",
};
const statusLabel: Record<JobStatus, string> = {
  NEW: "New",
  APPLIED: "Applied",
  REJECTED: "Rejected",
};

// Theme-token prose styles so the JD body reads cleanly on both light
// and dark surfaces. The prior slate-700/900 literals went invisible in
// dark mode; muted-foreground and foreground pull from the CSS theme.
const markdownStyles = {
  heading:
    "text-lg font-semibold text-foreground border-t border-border/60 pt-4 mt-4 first:border-0 first:mt-0 first:pt-0",
  subheading: "text-base font-semibold text-foreground mt-3",
  paragraph: "text-[15px] leading-relaxed text-foreground/85",
  list: "list-disc space-y-1.5 pl-5 text-[15px] text-foreground/85",
  listOrdered: "list-decimal space-y-1.5 pl-5 text-[15px] text-foreground/85",
  listItem: "text-[15px] leading-relaxed text-foreground/85",
  blockquote:
    "border-l-2 border-brand-emerald-200 bg-brand-emerald-50/40 px-4 py-2 text-sm text-foreground/85 rounded-r-lg",
  codeInline:
    "rounded bg-muted px-1.5 py-0.5 text-xs text-foreground/90",
  pre: "rounded-lg border border-border/60 bg-muted/50 p-3 text-xs text-foreground/90 overflow-auto",
  link: "text-brand-emerald-700 underline-offset-4 hover:underline",
  table: "w-full border-collapse text-sm",
  th: "border border-border/60 bg-muted/50 px-3 py-2 text-left font-semibold text-foreground",
  td: "border border-border/60 px-3 py-2 text-foreground/85",
};

interface JobDetailPanelProps {
  selectedJob: JobItem | null;
  selectedDescription: string;
  detailError: string | null;
  detailLoading: boolean;
  showLoadingOverlay: boolean;
  tailorSource?: { cv?: CvSource; cover?: CoverSource };
  updatingIds: Set<string>;
  deletingIds: Set<string>;
  highlightGenerate: boolean;
  guideHighlightClass: string;
  externalPromptLoading: boolean;
  mobileTab: "list" | "detail";
  onUpdateStatus: (id: string, status: JobStatus) => void;
  onDelete: (job: JobItem) => void;
  onGenerateResume: (job: JobItem) => void;
  onGenerateCover: (job: JobItem) => void;
}

export function JobDetailPanel({
  selectedJob,
  selectedDescription,
  detailError,
  detailLoading,
  showLoadingOverlay,
  tailorSource,
  updatingIds,
  deletingIds,
  highlightGenerate,
  guideHighlightClass,
  externalPromptLoading,
  mobileTab,
  onUpdateStatus,
  onDelete,
  onGenerateResume,
  onGenerateCover,
}: JobDetailPanelProps) {
  const t = useTranslations("jobs");
  const isAppliedSelected = selectedJob?.status === "APPLIED";
  const listOpacityClass = showLoadingOverlay ? "opacity-70" : "opacity-100";

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

  function highlightText(text: string) {
    const parts = text.split(highlightRegex);
    return parts.map((part, index) => {
      if (highlightRegex.test(part)) {
        return (
          <mark
            key={`${part}-${index}`}
            className="rounded-sm bg-brand-emerald-50 px-1 py-0.5 font-medium text-brand-emerald-800 ring-1 ring-brand-emerald-200/60"
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
    <div
      data-testid="jobs-details-panel"
      className={cn(
        "relative flex flex-col overflow-hidden backdrop-blur transition-shadow duration-200 ease-out",
        "rounded-2xl border border-border/70 bg-background/90 shadow-sm",
        "lg:rounded-3xl lg:border-2 lg:border-border/50 lg:bg-background/85 lg:shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] lg:hover:shadow-[0_24px_50px_-36px_rgba(5,150,105,0.22)]",
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
                  onValueChange={(v) => onUpdateStatus(selectedJob.id, v as JobStatus)}
                  disabled={updatingIds.has(selectedJob.id)}
                >
                  <SelectTrigger
                    className={`rounded-xl border-border bg-background shadow-sm ${
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
                  className={`w-full justify-center rounded-xl border border-brand-emerald-500 bg-brand-emerald-500 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-brand-emerald-600 hover:bg-brand-emerald-600 active:translate-y-[1px] sm:w-auto ${
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
                  onClick={() => onGenerateResume(selectedJob)}
                  className={`w-full justify-center rounded-xl border-border bg-background text-sm font-medium text-foreground/85 shadow-sm transition-all duration-200 hover:border-border hover:bg-muted active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none sm:w-auto ${
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
                  onClick={() => onGenerateCover(selectedJob)}
                  className={`w-full justify-center rounded-xl border-border bg-background text-sm font-medium text-foreground/85 shadow-sm transition-all duration-200 hover:border-border hover:bg-muted active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none sm:w-auto ${
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
                    className={`w-full justify-center rounded-xl border-border bg-background text-sm font-medium text-foreground/85 shadow-sm transition-all duration-200 hover:border-border hover:bg-muted active:translate-y-[1px] sm:w-auto ${
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
                    className={`w-full justify-center rounded-xl border-border bg-background text-sm font-medium text-foreground/85 shadow-sm transition-all duration-200 hover:border-border hover:bg-muted active:translate-y-[1px] sm:w-auto ${
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
                  onClick={() => onDelete(selectedJob)}
                  className={`w-full justify-center rounded-xl border-destructive/30 bg-destructive/10 text-sm font-medium text-destructive shadow-sm transition-all duration-200 hover:border-destructive/50 hover:bg-destructive/20 hover:text-destructive active:translate-y-[1px] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none sm:ml-auto sm:w-auto ${
                    isAppliedSelected ? "h-9 px-3.5" : "h-10 px-4"
                  }`}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
            {tailorSource ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {tailorSource.cv ? (
                  <span className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5">
                    CV: {tailorSource.cv === "ai" ? "AI" : tailorSource.cv === "manual_import" ? "Manual" : "Base"}
                  </span>
                ) : null}
                {tailorSource.cover ? (
                  <span className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5">
                    Cover: {tailorSource.cover === "ai" ? "AI" : tailorSource.cover === "manual_import" ? "Manual" : "Fallback"}
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
        <div className="p-4">
          {selectedJob ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <MatchScoreCard
                score={selectedJob.matchScore}
                breakdown={selectedJob.matchBreakdown}
              />
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Job Description
              </div>
              {experienceSignals.length ? (
                <div className="rounded-xl border border-border/60 bg-muted/40 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
                    Experience gate
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {experienceSignals.map((signal) => (
                      <span
                        key={signal.key}
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                          signal.isRequired
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-[theme(colors.tier-fair-ring)] bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]"
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
                <div className="space-y-3 rounded-lg border border-dashed border-border/60 bg-transparent p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (
                <div className="p-1">
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
                              <strong className="font-semibold text-foreground">
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
  );
}
