"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useTranslations } from "next-intl";
import "highlight.js/styles/github.css";
import type { VisibleJobExperienceProjection } from "@/lib/shared/jobExperienceAnalysis";
import { HIGHLIGHT_KEYWORDS, escapeRegExp } from "../utils/constants";
import { experienceEvidenceTargetId } from "./jobExperienceEvidenceTarget";

// Markdown body for the job description. Split into its own module so
// react-markdown + remark-gfm + rehype-highlight + the highlight.js CSS
// (~130KB gzip combined) load as a dynamic chunk only when a job is selected,
// instead of riding in the jobs-list critical path. Imported via next/dynamic
// from JobDetailPanel.
/**
 * One type scale for the description, aligned to the panel around it.
 *
 * Body was 15px while every control, chip and label on the same pane is 13-14,
 * so the description read as though the page had been zoomed. The steps are
 * 14 / 16 / 20: body and subheadings share a size and separate on weight,
 * section headings take the one step up, and nothing else competes.
 *
 * Section rules are gone. A hairline above every `##` cut a job ad into six
 * boxed fragments; spacing does the same grouping without drawing a line the
 * content did not ask for.
 */
const markdownStyles = {
  heading: "mt-6 text-base font-semibold text-foreground first:mt-0",
  subheading: "mt-4 text-sm font-semibold text-foreground",
  paragraph: "text-sm leading-6 text-foreground/85",
  list: "list-disc space-y-1 pl-5 text-sm leading-6 text-foreground/85 marker:text-muted-foreground",
  listOrdered:
    "list-decimal space-y-1 pl-5 text-sm leading-6 text-foreground/85 marker:text-muted-foreground",
  listItem: "text-sm leading-6 text-foreground/85",
  blockquote:
    "rounded-r-lg border-l-2 border-brand-emerald-300 bg-brand-emerald-50/40 px-4 py-2 text-sm leading-6 text-foreground/85 dark:bg-brand-emerald-500/10",
  codeInline:
    "rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground/90",
  pre: "overflow-auto rounded-lg border border-border/60 bg-muted/50 p-3 text-[13px] leading-6 text-foreground/90",
  link: "text-brand-emerald-text underline underline-offset-4 decoration-brand-emerald-300 hover:decoration-current",
  table: "w-full border-collapse text-[13px]",
  th: "border border-border/60 bg-muted/50 px-3 py-2 text-left font-semibold text-foreground",
  td: "border border-border/60 px-3 py-2 text-foreground/85",
};

type ExperienceHighlight = {
  requirementId: string;
  start: number;
  end: number;
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

function collectExperienceHighlights(
  description: string,
  experience: VisibleJobExperienceProjection,
): ExperienceHighlight[] {
  const candidates = experience.highlights
    .map((highlight) => ({
      requirementId: highlight.requirementId,
      start: highlight.start,
      end: highlight.end,
      expectedText: highlight.text,
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
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const accepted: ExperienceHighlight[] = [];
  for (const candidate of candidates) {
    const previous = accepted.at(-1);
    // Duplicate or overlapping evidence is rendered once. The shared
    // projector has already enforced REQUIRED-only visibility.
    if (previous && candidate.start < previous.end) continue;
    accepted.push({
      requirementId: candidate.requirementId,
      start: candidate.start,
      end: candidate.end,
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
  requiredLabel: string,
): HastNode {
  return {
    type: "element",
    tagName: "mark",
    properties: {
      id: experienceEvidenceTargetId(highlight.requirementId),
      tabIndex: -1,
      className: [
        "rounded-sm",
        "px-1",
        "py-0.5",
        "tabular-nums",
        "scroll-mt-24",
        "outline-none",
        "transition-[background-color,box-shadow]",
        "duration-500",
        "focus:ring-2",
        "focus:ring-brand-blue",
        "focus:ring-offset-2",
        "data-[evidence-active=true]:bg-brand-blue/25",
        "data-[evidence-active=true]:ring-2",
        "data-[evidence-active=true]:ring-brand-blue",
        "motion-reduce:transition-none",
        "bg-brand-blue/15",
        "font-bold",
        "text-foreground",
        "ring-1",
        "ring-brand-blue/45",
        "dark:bg-brand-blue/25",
      ],
      "data-experience-highlight": "REQUIRED",
      "aria-label": `${requiredLabel}: ${value}`,
    },
    children: [{ type: "text", value }],
  };
}

function splitTextNodeAtExperienceOffsets(
  node: HastNode,
  description: string,
  highlights: ExperienceHighlight[],
  requiredLabel: string,
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
      experienceMark(
        value.slice(localStart, localEnd),
        highlight,
        requiredLabel,
      ),
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
  experience: VisibleJobExperienceProjection,
  requiredLabel: string,
) {
  const highlights = collectExperienceHighlights(description, experience);

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
                requiredLabel,
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
  experience,
}: {
  description: string;
  experience: VisibleJobExperienceProjection;
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
      createExperienceHighlightPlugin(
        description,
        experience,
        t("classificationREQUIRED"),
      ),
    [description, experience, t],
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
    <div className="space-y-2">
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
