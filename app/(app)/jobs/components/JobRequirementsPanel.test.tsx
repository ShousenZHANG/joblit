import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import type { JobExperienceAnalysis } from "@/lib/shared/jobExperienceAnalysis";
import type { FitMatrix } from "@/lib/shared/schemas/fitMatrix";
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

afterEach(cleanup);

function renderPanel(props: Parameters<typeof JobRequirementsPanel>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <JobRequirementsPanel {...props} />
    </NextIntlClientProvider>,
  );
}

function analysisWith(
  requirements: JobExperienceAnalysis["requirements"],
  status: JobExperienceAnalysis["status"] = "FOUND",
): JobExperienceAnalysis {
  return { schemaVersion: 1, status, requirements };
}

const QA_EVIDENCE_TEXT = "5+ years of experience in software QA";
const REQUIRED_QA: JobExperienceAnalysis["requirements"][number] = {
  id: "req-1",
  classification: "REQUIRED",
  years: { operator: "MINIMUM", min: 5, max: null, text: "5+ years" },
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
  years: { operator: "MINIMUM", min: 3, max: null, text: "3 years" },
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
  it("renders a confident requirement as the headline with its JD quote", () => {
    renderPanel({
      analysis: analysisWith([REQUIRED_QA]),
      description: "",
      matrix: null,
    });

    expect(screen.getByText("5+ years")).toBeInTheDocument();
    expect(screen.getByText("· software QA")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    // Experience owns the amber channel — one glance, one hue.
    expect(
      screen.getByTestId("jd-experience-row").className,
    ).toMatch(/amber/);
    // The JD quote stays reachable behind the inline disclosure.
    expect(
      screen.getByText("5+ years of experience in software QA"),
    ).toBeInTheDocument();
  });

  it("never renders a REVIEW candidate — no hedge card, no wording", () => {
    renderPanel({
      analysis: analysisWith([REVIEW_ONLY], "REVIEW"),
      description: "",
      matrix: null,
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
      description: DESCRIPTION,
      matrix: null,
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
    renderPanel({ analysis: null, description: DESCRIPTION, matrix: null });

    const chips = screen
      .getAllByTestId("jd-skill-chip")
      .map((chip) => chip.textContent);
    expect(chips.indexOf("SRE")).toBeLessThan(chips.indexOf("Airflow"));
  });

  it("gives unscored technology chips the sky channel, distinct from experience", () => {
    renderPanel({ analysis: null, description: DESCRIPTION, matrix: null });

    for (const chip of screen.getAllByTestId("jd-skill-chip")) {
      expect(chip.className).toMatch(/sky/);
      expect(chip.className).not.toMatch(/amber/);
    }
  });

  it("keeps judgement fill on chips once a scan lands", () => {
    const matrix = {
      requirements: [
        {
          id: "m-1",
          requirement: "Kubernetes",
          type: "REQUIRED",
          criticality: "CORE",
          judgement: "MATCH",
          evidence: "Kubernetes at Acme",
        },
      ],
      eligibility: { status: "CLEAR", reasons: [] },
    } as unknown as FitMatrix;

    renderPanel({ analysis: null, description: DESCRIPTION, matrix });

    const matched = screen
      .getAllByTestId("jd-skill-chip")
      .find((chip) => chip.textContent?.includes("Kubernetes"));
    expect(matched?.className).toMatch(/emerald/);
  });

  it("renders nothing at all for a job with no detectable asks", () => {
    const { container } = renderPanel({
      analysis: null,
      description: "We are a friendly team with great snacks.",
      matrix: null,
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
        years: { operator: "MINIMUM", min: 3, max: null, text: "3+ years" },
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
      description: "",
      matrix: null,
    });

    expect(screen.getByText("5+ years")).toBeInTheDocument();
    expect(screen.getByText("3+ years")).toBeInTheDocument();
    expect(screen.getByText(/^or$/i)).toBeInTheDocument();
  });
});
