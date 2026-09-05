import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { axe } from "vitest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import {
  EMPTY_VISIBLE_JOB_EXPERIENCE,
  JobExperienceAnalysisSchema,
  projectVisibleJobExperience,
  type JobExperienceAnalysis,
  type VisibleJobExperienceProjection,
} from "@/lib/shared/jobExperienceAnalysis";
import { JobDescriptionMarkdown } from "./JobDescriptionMarkdown";
import { JobRequirementsPanel } from "./JobRequirementsPanel";

/**
 * One quiet block replaces the two stacked cards. The design contract, agreed
 * over the four screenshots:
 *
 * - Only confident experience findings render; a REVIEW candidate (the
 *   "loyalty leave" false positive) renders nothing rather than a hedge card.
 * - Technology is one flat chip cluster — the GATE / CORE / PREFERRED tier
 *   headings, screening gates, nice-to-have, category dots and legend are all
 *   gone. Tier survives only as ordering (gates first).
 * - When a job asks for nothing detectable, the panel takes zero pixels.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type PanelTestProps = Omit<
  Parameters<typeof JobRequirementsPanel>[0],
  "experience"
> & {
  analysis?: JobExperienceAnalysis | null;
};

function panelProjection(
  description: string,
  analysis?: JobExperienceAnalysis | null,
): VisibleJobExperienceProjection {
  if (description) return projectVisibleJobExperience(description, analysis);
  if (!analysis) return EMPTY_VISIBLE_JOB_EXPERIENCE;
  const requirements = analysis.requirements.filter(
    (requirement) => requirement.classification === "REQUIRED",
  );
  return { requirements, highlights: [] };
}

function renderPanel({ analysis, description, ...props }: PanelTestProps) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <JobRequirementsPanel
        {...props}
        description={description}
        experience={panelProjection(description, analysis)}
      />
    </NextIntlClientProvider>,
  );
}

function analysisWith(
  requirements: JobExperienceAnalysis["requirements"],
  status: JobExperienceAnalysis["status"] = "FOUND",
): JobExperienceAnalysis {
  return JobExperienceAnalysisSchema.parse({
    schemaVersion: 3,
    status,
    requirements,
  });
}

const QA_EVIDENCE_TEXT = "5+ years of experience in software QA";
const REQUIRED_QA: JobExperienceAnalysis["requirements"][number] = {
  id: "req-1",
  classification: "REQUIRED",
  years: { operator: "AT_LEAST", min: 5, max: null, text: "5+ years" },
  scope: "software QA",
  evidence: {
    text: QA_EVIDENCE_TEXT,
    start: 10,
    end: 10 + QA_EVIDENCE_TEXT.length,
    yearsStart: 10,
    yearsEnd: 18,
  },
};

const REVIEW_EVIDENCE_TEXT =
  "An additional week's Loyalty Leave each year after reaching 3 years' service";
const REVIEW_ONLY: JobExperienceAnalysis["requirements"][number] = {
  id: "rev-1",
  classification: "REVIEW",
  years: { operator: "EXACT", min: 3, max: 3, text: "3 years" },
  scope: null,
  evidence: {
    text: REVIEW_EVIDENCE_TEXT,
    start: 0,
    end: REVIEW_EVIDENCE_TEXT.length,
    yearsStart: 61,
    yearsEnd: 68,
  },
};

const DESCRIPTION = [
  "Requirements:",
  "Must have SRE experience.",
  "Strong Kubernetes and Terraform required.",
  "Nice to have: Airflow.",
  "Security clearance required. Bachelor's degree or equivalent experience.",
].join("\n");

describe("JobRequirementsPanel", () => {
  it("renders one neutral role-requirements surface with a compact experience row", () => {
    renderPanel({
      analysis: analysisWith([REQUIRED_QA]),
      description: ""
    });

    expect(
      screen.getByRole("heading", { name: "Role requirements" }),
    ).toBeInTheDocument();
    expect(screen.getByText("5+ years")).toBeInTheDocument();
    expect(screen.getByText("software QA")).toBeInTheDocument();
    expect(screen.getByText("5+ years")).toHaveClass("text-foreground");
    expect(screen.getByTestId("jd-requirements-panel").className).not.toMatch(
      /amber/,
    );
    expect(screen.getByTestId("jd-experience-row")).toHaveAttribute(
      "data-requirement-family",
      "experience",
    );
    expect(screen.getByTestId("jd-experience-row").className).toMatch(
      /brand-blue/,
    );
    expect(
      screen.getByRole("button", {
        name: /view 5\+ years in job description/i,
      }),
    ).toHaveClass("h-8", "[@media(any-pointer:coarse)]:min-h-11");
    expect(
      screen.queryByText("5+ years of experience in software QA"),
    ).not.toBeInTheDocument();
  });

  it("never renders a REVIEW candidate — no hedge card, no wording", () => {
    renderPanel({
      analysis: analysisWith([REVIEW_ONLY], "REVIEW"),
      description: ""
    });

    expect(screen.queryByText(/Loyalty Leave/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Possible experience/i)).not.toBeInTheDocument();
    // Nothing else to show either: the panel contributes zero pixels.
    expect(
      screen.queryByTestId("jd-requirements-panel"),
    ).not.toBeInTheDocument();
  });

  it("flattens technology into one cluster with no tier or gate sections", () => {
    renderPanel({
      analysis: null,
      description: DESCRIPTION
    });

    expect(screen.getByText("SRE")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("Airflow")).toBeInTheDocument();

    for (const heading of [
      /explicit must-have/i,
      /core technology/i,
      /^preferred$/i,
      /screening gates/i,
      /nice to have/i,
    ]) {
      expect(screen.queryByText(heading)).not.toBeInTheDocument();
    }
    // The structural chips are gone with their sections.
    expect(screen.queryByText(/security clearance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/degree/i)).not.toBeInTheDocument();
  });

  it("orders gate-tier skills before the rest of the cluster", () => {
    renderPanel({ analysis: null, description: DESCRIPTION });

    const chips = screen
      .getAllByTestId("jd-skill-chip")
      .map((chip) => chip.textContent);
    expect(chips.indexOf("SRE")).toBeLessThan(chips.indexOf("Airflow"));
  });

  it("gives technology one consistent emerald identity", () => {
    renderPanel({ analysis: null, description: DESCRIPTION });

    for (const chip of screen.getAllByTestId("jd-skill-chip")) {
      expect(chip.className).toMatch(/emerald/);
      expect(chip.className).not.toMatch(/amber/);
      expect(chip.className).not.toMatch(/sky/);
    }
  });

  it("renders nothing at all for a job with no detectable asks", () => {
    const { container } = renderPanel({
      analysis: null,
      description: "We are a friendly team with great snacks."
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("joins grouped alternatives with the relation tag", () => {
    const altEvidence = "or 3+ years in test automation";
    const grouped: JobExperienceAnalysis["requirements"] = [
      {
        ...REQUIRED_QA,
        id: "req-a",
        relation: { groupId: "g1", kind: "ANY_OF" },
      },
      {
        ...REQUIRED_QA,
        id: "req-b",
        years: { operator: "AT_LEAST", min: 3, max: null, text: "3+ years" },
        scope: "test automation",
        relation: { groupId: "g1", kind: "ANY_OF" },
        evidence: {
          text: altEvidence,
          start: 60,
          end: 60 + altEvidence.length,
          yearsStart: 63,
          yearsEnd: 71,
        },
      },
    ];

    renderPanel({
      analysis: analysisWith(grouped),
      description: ""
    });

    expect(screen.getByText("5+ years")).toBeInTheDocument();
    expect(screen.getByText("3+ years")).toBeInTheDocument();
    expect(screen.getByText(/^or$/i)).toBeInTheDocument();
  });

  it("hides stated, preferred and alternative quantities from the product UI", () => {
    const variants = [
      { ...REQUIRED_QA, id: "stated", classification: "STATED" },
      {
        ...REQUIRED_QA,
        id: "preferred",
        classification: "PREFERRED",
        evidence: {
          ...REQUIRED_QA.evidence,
          start: 60,
          end: 60 + QA_EVIDENCE_TEXT.length,
          yearsStart: 60,
          yearsEnd: 68,
        },
      },
      {
        ...REQUIRED_QA,
        id: "alternative",
        classification: "ALTERNATIVE",
        evidence: {
          ...REQUIRED_QA.evidence,
          start: 110,
          end: 110 + QA_EVIDENCE_TEXT.length,
          yearsStart: 110,
          yearsEnd: 118,
        },
      },
    ] satisfies JobExperienceAnalysis["requirements"];

    renderPanel({
      analysis: analysisWith(variants),
      description: ""
    });

    expect(screen.queryByTestId("jd-requirements-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("5+ years")).not.toBeInTheDocument();
  });

  it("indents a nested subset and labels it as included", () => {
    const nested = [
      {
        ...REQUIRED_QA,
        id: "total",
        relation: { groupId: "nested", kind: "ALL_OF", role: "TOTAL" },
      },
      {
        ...REQUIRED_QA,
        id: "subset",
        years: { operator: "EXACT", min: 2, max: 2, text: "2 years" },
        scope: "cloud architecture",
        relation: { groupId: "nested", kind: "ALL_OF", role: "SUBSET" },
        evidence: {
          text: "2 years of cloud architecture experience",
          start: 60,
          end: 100,
          yearsStart: 60,
          yearsEnd: 67,
        },
      },
    ] satisfies JobExperienceAnalysis["requirements"];

    renderPanel({
      analysis: analysisWith(nested),
      description: ""
    });

    const subset = screen.getByText("2 years").closest("[data-relation-role]");
    expect(subset).toHaveAttribute("data-relation-role", "SUBSET");
    expect(subset?.className).toMatch(/ml-/);
    expect(screen.getByText("Includes")).toBeInTheDocument();
  });

  it("moves focus to the exact JD mark with reduced-motion-safe scrolling", () => {
    const description = `Context. ${QA_EVIDENCE_TEXT}.`;
    const requirement = {
      ...REQUIRED_QA,
      evidence: {
        text: QA_EVIDENCE_TEXT,
        start: description.indexOf(QA_EVIDENCE_TEXT),
        end: description.indexOf(QA_EVIDENCE_TEXT) + QA_EVIDENCE_TEXT.length,
        yearsStart: description.indexOf("5+ years"),
        yearsEnd: description.indexOf("5+ years") + "5+ years".length,
      },
    };
    const analysis = analysisWith([requirement]);
    const experience = projectVisibleJobExperience(description, analysis);
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      scrollIntoView,
    );
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <JobRequirementsPanel
          experience={experience}
          description={description}
        />
        <JobDescriptionMarkdown
          description={description}
          experience={experience}
        />
      </NextIntlClientProvider>,
    );

    const button = screen.getByRole("button", {
      name: /view 5\+ years in job description/i,
    });
    const targetId = button.getAttribute("aria-controls");
    expect(targetId).toBeTruthy();
    const target = document.getElementById(targetId ?? "");
    expect(target).toHaveAttribute("tabindex", "-1");

    fireEvent.click(button);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute("data-evidence-active", "true");
    vi.advanceTimersByTime(1_600);
    expect(target).not.toHaveAttribute("data-evidence-active");
  });

  it("retries a View in JD request until the dynamic Markdown target mounts", () => {
    const description = `Context. ${QA_EVIDENCE_TEXT}.`;
    const requirement = {
      ...REQUIRED_QA,
      evidence: {
        text: QA_EVIDENCE_TEXT,
        start: description.indexOf(QA_EVIDENCE_TEXT),
        end: description.indexOf(QA_EVIDENCE_TEXT) + QA_EVIDENCE_TEXT.length,
        yearsStart: description.indexOf("5+ years"),
        yearsEnd: description.indexOf("5+ years") + "5+ years".length,
      },
    };
    const analysis = analysisWith([requirement]);
    const experience = projectVisibleJobExperience(description, analysis);
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      scrollIntoView,
    );

    const view = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <JobRequirementsPanel
          experience={experience}
          description={description}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /view 5\+ years in job description/i,
      }),
    );
    expect(
      screen.getByRole("button", { name: /finding 5\+ years/i }),
    ).toHaveAttribute("aria-busy", "true");

    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <JobRequirementsPanel
          experience={experience}
          description={description}
        />
        <JobDescriptionMarkdown
          description={description}
          experience={experience}
        />
      </NextIntlClientProvider>,
    );
    act(() => vi.advanceTimersByTime(150));

    const target = document.getElementById("jd-experience-req-1");
    expect(target).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", {
        name: /view 5\+ years in job description/i,
      }),
    ).not.toHaveAttribute("aria-busy", "true");
  });

  it("ends a missing-target retry with explicit feedback and no live timer", () => {
    vi.useFakeTimers();
    renderPanel({
      analysis: analysisWith([REQUIRED_QA]),
      description: ""
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /view 5\+ years in job description/i,
      }),
    );
    act(() => vi.runAllTimers());

    expect(
      screen.getByRole("button", {
        name: /5\+ years is not available in the jd/i,
      }),
    ).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has no detectable accessibility violations", async () => {
    const description = `Requirements: ${QA_EVIDENCE_TEXT}. Kubernetes is required.`;
    const requirement = {
      ...REQUIRED_QA,
      evidence: {
        text: QA_EVIDENCE_TEXT,
        start: description.indexOf(QA_EVIDENCE_TEXT),
        end: description.indexOf(QA_EVIDENCE_TEXT) + QA_EVIDENCE_TEXT.length,
        yearsStart: description.indexOf("5+ years"),
        yearsEnd: description.indexOf("5+ years") + "5+ years".length,
      },
    };
    const analysis = analysisWith([requirement]);
    const experience = projectVisibleJobExperience(description, analysis);    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <JobRequirementsPanel
          experience={experience}
          description={description}
        />
        <JobDescriptionMarkdown
          description={description}
          experience={experience}
        />
      </NextIntlClientProvider>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
