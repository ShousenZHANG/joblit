"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
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
  link: "text-brand-emerald-700 underline-offset-4 hover:underline",
  table: "w-full border-collapse text-sm",
  th: "border border-border/60 bg-muted/50 px-3 py-2 text-left font-semibold text-foreground",
  td: "border border-border/60 px-3 py-2 text-foreground/85",
};

export function JobDescriptionMarkdown({ description }: { description: string }) {
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
