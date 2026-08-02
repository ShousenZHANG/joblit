"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useTranslations } from "next-intl";
import "highlight.js/styles/github.css";
import type {
  ExperienceClassification,
  JobExperienceAnalysis,
} from "@/lib/shared/jobExperienceAnalysis";
import { HIGHLIGHT_KEYWORDS, escapeRegExp } from "../utils/constants";

// Markdown body for the job description. Split into its own module so
// react-markdown + remark-gfm + rehype-highlight + the highlight.js CSS
// (~130KB gzip combined) load as a dynamic chunk only when a job is selected,
// instead of riding in the jobs-list critical path. Imported via next/dynamic
// from JobDetailPanel.
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
  codeInline: "rounded bg-muted px-1.5 py-0.5 text-xs text-foreground/90",
  pre: "rounded-lg border border-border/60 bg-muted/50 p-3 text-xs text-foreground/90 overflow-auto",
  link: "text-brand-emerald-text underline-offset-4 hover:underline",
  table: "w-full border-collapse text-sm",
  th: "border border-border/60 bg-muted/50 px-3 py-2 text-left font-semibold text-foreground",
  td: "border border-border/60 px-3 py-2 text-foreground/85",
};

type ExperienceHighlight = {
  start: number;
  end: number;
  classification: ExperienceClassification;
};

type HastPoint = {
  offset?: number;
};

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: {
    start: HastPoint;
    end: HastPoint;
  };
};

const CLASSIFICATION_PRIORITY: Record<ExperienceClassification, number> = {
  REQUIRED: 3,
  PREFERRED: 2,
  REVIEW: 1,
};

const EXPERIENCE_HIGHLIGHT_TONE: Record<ExperienceClassification, string> = {
  REQUIRED:
    "bg-amber-100 text-amber-950 ring-1 ring-amber-300/80 dark:bg-amber-300/20 dark:text-amber-50 dark:ring-amber-300/40",
  PREFERRED:
    "bg-sky-100 text-sky-950 ring-1 ring-sky-300/80 dark:bg-sky-300/20 dark:text-sky-50 dark:ring-sky-300/40",
  REVIEW:
    "bg-slate-200 text-slate-950 ring-1 ring-slate-300/80 dark:bg-slate-300/20 dark:text-slate-50 dark:ring-slate-300/35",
};

function collectExperienceHighlights(
  description: string,
  analysis?: JobExperienceAnalysis | null,
): ExperienceHighlight[] {
  const candidates = (analysis?.requirements ?? [])
    .map((requirement) => ({
      start: requirement.evidence.yearsStart,
      end: requirement.evidence.yearsEnd,
      classification: requirement.classification,
      expectedText: requirement.years.text,
    }))
    .filter(
      ({ start, end, expectedText }) =>
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end > start &&
        end <= description.length &&
        description.slice(start, end) === expectedText,
    )
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        CLASSIFICATION_PRIORITY[b.classification] -
          CLASSIFICATION_PRIORITY[a.classification],
    );

  const accepted: ExperienceHighlight[] = [];
  for (const candidate of candidates) {
    const previous = accepted.at(-1);
    // Duplicate or overlapping evidence is rendered once. Candidates are
    // priority-sorted, so REQUIRED wins over PREFERRED/REVIEW at one span.
    if (previous && candidate.start < previous.end) continue;
    accepted.push({
      start: candidate.start,
      end: candidate.end,
      classification: candidate.classification,
    });
  }
  return accepted;
}

/**
 * HAST text nodes retain source positions from the Markdown parser. A direct
 * source/value match is ideal. Inline code includes its backtick delimiters in
 * the source range, so a single, exact occurrence of the displayed value is
 * also safe to map. Entities, escapes and ambiguous repeated values fail
 * closed: the JD remains readable and no guessed highlight is rendered.
 */
function sourceStartForTextNode(
  node: HastNode,
  description: string,
): number | null {
  if (node.type !== "text" || typeof node.value !== "string") return null;
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start === undefined ||
    end === undefined ||
    start < 0 ||
    end < start ||
    end > description.length
  ) {
    return null;
  }

  const source = description.slice(start, end);
  if (source === node.value) return start;

  const occurrence = source.indexOf(node.value);
  if (
    occurrence < 0 ||
    source.indexOf(node.value, occurrence + node.value.length) >= 0
  ) {
    return null;
  }
  return start + occurrence;
}

function experienceMark(
  value: string,
  highlight: ExperienceHighlight,
  labels: Record<ExperienceClassification, string>,
): HastNode {
  return {
    type: "element",
    tagName: "mark",
    properties: {
      className: [
        "rounded-sm",
        "px-1",
        "py-0.5",
        "font-bold",
        "tabular-nums",
        ...EXPERIENCE_HIGHLIGHT_TONE[highlight.classification].split(" "),
      ],
      "data-experience-highlight": highlight.classification,
      "aria-label": `${labels[highlight.classification]}: ${value}`,
    },
    children: [{ type: "text", value }],
  };
}

function splitTextNodeAtExperienceOffsets(
  node: HastNode,
  description: string,
  highlights: ExperienceHighlight[],
  labels: Record<ExperienceClassification, string>,
): HastNode[] {
  const value = node.value;
  if (typeof value !== "string") return [node];
  const sourceStart = sourceStartForTextNode(node, description);
  if (sourceStart === null) return [node];
  const sourceEnd = sourceStart + value.length;
  const contained = highlights.filter(
    (highlight) =>
      highlight.start >= sourceStart && highlight.end <= sourceEnd,
  );
  if (!contained.length) return [node];

  const output: HastNode[] = [];
  let cursor = 0;
  for (const highlight of contained) {
    const localStart = highlight.start - sourceStart;
    const localEnd = highlight.end - sourceStart;
    if (localStart < cursor || localEnd > value.length) return [node];
    if (localStart > cursor) {
      output.push({ type: "text", value: value.slice(cursor, localStart) });
    }
    output.push(
      experienceMark(value.slice(localStart, localEnd), highlight, labels),
    );
    cursor = localEnd;
  }
  if (cursor < value.length) {
    output.push({ type: "text", value: value.slice(cursor) });
  }
  return output;
}

function createExperienceHighlightPlugin(
  description: string,
  analysis: JobExperienceAnalysis | null | undefined,
  labels: Record<ExperienceClassification, string>,
) {
  const highlights = collectExperienceHighlights(description, analysis);

  return function rehypeExperienceHighlights() {
    return (tree: HastNode) => {
      const visit = (parent: HastNode) => {
        if (!parent.children?.length) return;
        const nextChildren: HastNode[] = [];
        for (const child of parent.children) {
          if (child.type === "text") {
            nextChildren.push(
              ...splitTextNodeAtExperienceOffsets(
                child,
                description,
                highlights,
                labels,
              ),
            );
          } else {
            visit(child);
            nextChildren.push(child);
          }
        }
        parent.children = nextChildren;
      };
      visit(tree);
    };
  };
}

export function JobDescriptionMarkdown({
  description,
  experienceAnalysis,
}: {
  description: string;
  experienceAnalysis?: JobExperienceAnalysis | null;
}) {
  const t = useTranslations("jobs.experienceRequirement");
  const highlightRegex = useMemo(() => {
    const patterns = HIGHLIGHT_KEYWORDS.map((keyword) => {
      const escaped = escapeRegExp(keyword);
      const isPlainWord = /^[a-z0-9.+#-]+$/i.test(keyword);
      return isPlainWord ? `\\b${escaped}\\b` : escaped;
    });
    return new RegExp(`(${patterns.join("|")})`, "i");
  }, []);
  const experienceHighlightPlugin = useMemo(
    () =>
      createExperienceHighlightPlugin(description, experienceAnalysis, {
        REQUIRED: t("classificationREQUIRED"),
        PREFERRED: t("classificationPREFERRED"),
        REVIEW: t("classificationREVIEW"),
      }),
    [description, experienceAnalysis, t],
  );

  function highlightKeywords(text: string, keyPrefix: string) {
    const parts = text.split(highlightRegex);
    return parts.map((part, index) => {
      if (highlightRegex.test(part)) {
        return (
          <mark
            key={`${keyPrefix}-keyword-${index}`}
            className="rounded-sm bg-brand-emerald-50 px-1 py-0.5 font-medium text-brand-emerald-800 ring-1 ring-brand-emerald-200/60"
          >
            {part}
          </mark>
        );
      }
      return <span key={`${keyPrefix}-text-${index}`}>{part}</span>;
    });
  }

  function highlightText(text: string) {
    return highlightKeywords(text, "jd-text");
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
    <div className="space-y-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, experienceHighlightPlugin]}
        components={{
          h2: ({ children }) => (
            <h2 className={markdownStyles.heading}>{renderHighlighted(children)}</h2>
          ),
          h3: ({ children }) => (
            <h3 className={markdownStyles.subheading}>{renderHighlighted(children)}</h3>
          ),
          p: ({ children }) => (
            <p className={markdownStyles.paragraph}>{renderHighlighted(children)}</p>
          ),
          ul: ({ children }) => <ul className={markdownStyles.list}>{children}</ul>,
          ol: ({ children }) => (
            <ol className={markdownStyles.listOrdered}>{children}</ol>
          ),
          li: ({ children }) => (
            <li className={markdownStyles.listItem}>{renderHighlighted(children)}</li>
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
        {description}
      </ReactMarkdown>
    </div>
  );
}
