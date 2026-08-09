import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  JobExperienceAnalysisSchema,
  projectVisibleJobExperience,
  type JobExperienceAnalysis,
} from "@/lib/shared/jobExperienceAnalysis";
import messages from "@/messages/en.json";
import { JobDescriptionMarkdown } from "./JobDescriptionMarkdown";

afterEach(cleanup);

function analysisFor(
  description: string,
  phrase: string,
  occurrence: "first" | "last" = "last",
  classification: "REQUIRED" | "PREFERRED" | "REVIEW" = "REQUIRED",
): JobExperienceAnalysis {
  const yearsStart =
    occurrence === "first"
      ? description.indexOf(phrase)
      : description.lastIndexOf(phrase);
  const sentenceStart = description.lastIndexOf("\n", yearsStart) + 1;
  const nextNewline = description.indexOf("\n", yearsStart);
  const sentenceEnd = nextNewline === -1 ? description.length : nextNewline;

  return JobExperienceAnalysisSchema.parse({
    schemaVersion: 3,
    status: classification === "REVIEW" ? "REVIEW" : "FOUND",
    requirements: [
      {
        id: "experience-1",
        classification,
        years: { operator: "AT_LEAST", min: 3, max: null, text: phrase },
        scope: "backend engineering",
        evidence: {
          text: description.slice(sentenceStart, sentenceEnd),
          start: sentenceStart,
          end: sentenceEnd,
          yearsStart,
          yearsEnd: yearsStart + phrase.length,
        },
      },
    ],
  });
}

function renderMarkdown(
  description: string,
  experienceAnalysis: JobExperienceAnalysis | null,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <JobDescriptionMarkdown
        description={description}
        experience={projectVisibleJobExperience(
          description,
          experienceAnalysis,
        )}
      />
    </NextIntlClientProvider>,
  );
}

function analysisForPhrases(
  description: string,
  phrases: string[],
): JobExperienceAnalysis {
  return JobExperienceAnalysisSchema.parse({
    schemaVersion: 3,
    status: "FOUND",
    requirements: phrases.map((phrase, index) => {
      const yearsStart = description.indexOf(phrase);
      const lineStart = description.lastIndexOf("\n", yearsStart) + 1;
      const nextNewline = description.indexOf("\n", yearsStart);
      const lineEnd = nextNewline === -1 ? description.length : nextNewline;
      return {
        id: `experience-${index}`,
        classification: "REQUIRED" as const,
        years: {
          operator: "AT_LEAST" as const,
          min: Number.parseInt(phrase, 10),
          max: null,
          text: phrase,
        },
        scope: null,
        evidence: {
          text: description.slice(lineStart, lineEnd),
          start: lineStart,
          end: lineEnd,
          yearsStart,
          yearsEnd: yearsStart + phrase.length,
        },
      };
    }),
  });
}

const structuredMarkdown = [
  "**Required:** **3+ years** of platform work.",
  "",
  "See the [4+ years requirement](https://example.com/requirement).",
  "",
  "| Requirement |",
  "| --- |",
  "| 5+ years |",
  "",
  "Inline source: `6+ years`.",
].join("\n");

describe("JobDescriptionMarkdown experience evidence", () => {
  it("highlights only the exact offset when the same year phrase appears twice", () => {
    const description =
      "Company history: 3+ years.\n\nRequired: 3+ years of backend experience.";
    const view = renderMarkdown(
      description,
      analysisFor(description, "3+ years", "last"),
    );

    const marks = view.container.querySelectorAll(
      "mark[data-experience-highlight='REQUIRED']",
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("3+ years");
    expect(marks[0]).toHaveAttribute("aria-label", "Required: 3+ years");
    expect(marks[0]).toHaveClass("bg-brand-blue/15", "dark:bg-brand-blue/25");
    expect(screen.getAllByText("3+ years", { exact: false })).toHaveLength(2);
    const paragraphs = view.container.querySelectorAll("p");
    expect(paragraphs[0].querySelector("[data-experience-highlight]")).toBeNull();
    expect(
      paragraphs[1].querySelector("[data-experience-highlight='REQUIRED']"),
    ).toHaveTextContent("3+ years");
  });

  it("keeps the existing technology highlighting alongside experience evidence", () => {
    const description = "Required: 3+ years of TypeScript experience.";
    const view = renderMarkdown(
      description,
      analysisFor(description, "3+ years"),
    );

    expect(
      view.container.querySelector("mark[data-experience-highlight='REQUIRED']"),
    ).toHaveTextContent("3+ years");
    expect(screen.getByText("TypeScript").closest("mark")).toHaveClass(
      "bg-brand-emerald-50",
    );
  });

  it("fails closed when stale offsets no longer point at the analysed phrase", () => {
    const description = "Required: 3+ years of backend experience.";
    const stale = analysisFor(description, "3+ years");
    stale.requirements[0].evidence.yearsStart = 0;
    stale.requirements[0].evidence.yearsEnd = 8;

    const view = renderMarkdown(description, stale);
    expect(
      view.container.querySelector("[data-experience-highlight]"),
    ).toBeNull();
    expect(screen.getByText(/3\+ years/)).toBeInTheDocument();
  });

  it("fails closed when Markdown escaping prevents a one-to-one source mapping", () => {
    const description = "Required: 3\\+ years of backend experience.";
    const view = renderMarkdown(
      description,
      analysisFor(description, "3\\+ years"),
    );

    expect(
      view.container.querySelector("[data-experience-highlight]"),
    ).toBeNull();
    expect(view.container).toHaveTextContent("Required: 3+ years of backend experience.");
    expect(view.container.textContent).not.toMatch(
      /joblit-experience|[\uE000-\uF8FF]/u,
    );
  });

  it("renders no experience mark for wording that still needs human review", () => {
    const description = "The JD mentions about 4 years of platform exposure.";
    const view = renderMarkdown(
      description,
      analysisFor(description, "4 years", "last", "REVIEW"),
    );

    expect(
      view.container.querySelector("mark[data-experience-highlight='REVIEW']"),
    ).toBeNull();
    expect(view.container).toHaveTextContent(
      "The JD mentions about 4 years of platform exposure.",
    );
  });

  it("gives a confident duration a stable focus target", () => {
    const description = "Required: 3+ years of backend experience.";
    const view = renderMarkdown(
      description,
      analysisFor(description, "3+ years"),
    );

    const mark = view.container.querySelector(
      "mark[data-experience-highlight='REQUIRED']",
    );
    expect(mark).toHaveAttribute("id", "jd-experience-experience-1");
    expect(mark).toHaveAttribute("tabindex", "-1");
    expect(mark).toHaveClass(
      "scroll-mt-24",
      "focus:ring-2",
      "focus:ring-brand-blue",
      "motion-reduce:transition-none",
    );
  });

  it("uses source offsets inside strong, links, table cells and inline code without leaking internals", () => {
    const view = renderMarkdown(
      structuredMarkdown,
      analysisForPhrases(structuredMarkdown, [
        "3+ years",
        "4+ years",
        "5+ years",
        "6+ years",
      ]),
    );

    const strongMark = screen.getByLabelText("Required: 3+ years");
    const linkMark = screen.getByLabelText("Required: 4+ years");
    const tableMark = screen.getByLabelText("Required: 5+ years");
    const codeMark = screen.getByLabelText("Required: 6+ years");
    expect(strongMark.closest("strong")).not.toBeNull();
    expect(linkMark.closest("a")).toHaveAttribute(
      "href",
      "https://example.com/requirement",
    );
    expect(tableMark.closest("td")).not.toBeNull();
    expect(codeMark.closest("code")).not.toBeNull();
    expect(
      view.container.querySelectorAll("[data-experience-highlight='REQUIRED']"),
    ).toHaveLength(4);
    expect(view.container.textContent).not.toMatch(
      /joblit-experience|[\uE000-\uF8FF]/u,
    );
  });

  it("server-renders structured Markdown with no private marker text", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages}>
        <JobDescriptionMarkdown
          description={structuredMarkdown}
          experience={projectVisibleJobExperience(
            structuredMarkdown,
            analysisForPhrases(structuredMarkdown, [
              "3+ years",
              "4+ years",
              "5+ years",
              "6+ years",
            ]),
          )}
        />
      </NextIntlClientProvider>,
    );

    expect(html.match(/data-experience-highlight="REQUIRED"/g)).toHaveLength(4);
    expect(html).not.toMatch(/joblit-experience|[\uE000-\uF8FF]/u);
    expect(html).toContain("<strong");
    expect(html).toContain("<a href=\"https://example.com/requirement\"");
    expect(html).toContain("<td");
    expect(html).toContain("<code");
  });
});
