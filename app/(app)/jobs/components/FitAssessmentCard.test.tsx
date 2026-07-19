import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import type { FitMatrix } from "@/lib/shared/schemas/fitMatrix";
import {
  buildTechnicalSignals,
  FitAssessmentCard,
} from "./FitAssessmentCard";

const messages = {
  jobs: {
    fitAssessment: {
      title: "Fit evidence",
      subtitle: "JD priorities and candidate gaps",
      gateClear: "Gate clear",
      gateReview: "Gate review",
      gateBlocked: "Gate blocked",
      tierGATE: "Gate · explicit must-have",
      tierCORE: "Core technology",
      tierPREFERRED: "Preferred",
      screeningGates: "Screening gates",
      gateGaps: "Gate gaps",
      coreGaps: "Core gaps",
    },
  },
};

const matrix: FitMatrix = {
  requirements: [
    {
      id: "r1",
      type: "REQUIRED",
      criticality: "GATE",
      category: "TECHNICAL",
      requirement: "Production Kubernetes experience",
      judgement: "GAP",
      jdEvidence: "Kubernetes is mandatory",
      note: "No Kubernetes evidence",
    },
    {
      id: "r2",
      type: "RESPONSIBILITY",
      criticality: "CORE",
      category: "TECHNICAL",
      requirement: "Build TypeScript services",
      judgement: "MATCH",
      jdEvidence: "Build TypeScript services",
      candidateEvidence: "Delivered TypeScript APIs",
    },
  ],
  eligibility: { status: "PASS", reasons: [] },
};

afterEach(cleanup);

describe("FitAssessmentCard", () => {
  it("maps each technology once into GATE, CORE and PREFERRED tiers", () => {
    const signals = buildTechnicalSignals(
      `
        Must-haves: Kubernetes.
        Responsibilities: Build TypeScript services.
        Nice to have: React Native.
      `,
      matrix,
    );
    expect(signals.map(({ skill, tier, judgement }) => [
      skill,
      tier,
      judgement,
    ])).toEqual([
      ["Kubernetes", "GATE", "GAP"],
      ["TypeScript", "CORE", "MATCH"],
      ["React Native", "PREFERRED", undefined],
    ]);
  });

  it("does not mark every side of a satisfied OR alternative as matched", () => {
    const alternativeMatrix: FitMatrix = {
      requirements: [
        {
          id: "r1",
          type: "REQUIRED",
          criticality: "GATE",
          category: "TECHNICAL",
          requirement: "Kubernetes or Docker production experience",
          judgement: "MATCH",
          candidateEvidence: "Operated Docker in production",
        },
      ],
      eligibility: { status: "PASS", reasons: [] },
    };
    const signals = buildTechnicalSignals(
      "Must have Kubernetes or Docker production experience.",
      alternativeMatrix,
    );
    expect(signals.find((signal) => signal.skill === "Docker")?.judgement).toBe(
      "MATCH",
    );
    expect(
      signals.find((signal) => signal.skill === "Kubernetes")?.judgement,
    ).toBeUndefined();
  });

  it("shows score, layered JD technology and explicit gate/core gaps", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FitAssessmentCard
          description={`
            Must-haves: Kubernetes and 5+ years of backend experience.
            Responsibilities: Build TypeScript services.
            Nice to have: React Native.
          `}
          score={29}
          verdict="POOR"
          eligibility="PASS"
          matrix={matrix}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Fit evidence" })).toBeInTheDocument();
    expect(screen.getByText("29/100 · POOR")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gate blocked");
    expect(screen.getByText("Gate · explicit must-have")).toBeInTheDocument();
    expect(screen.getByText("Core technology")).toBeInTheDocument();
    expect(screen.getByText("Preferred")).toBeInTheDocument();
    expect(screen.getByText("Gate gaps")).toBeInTheDocument();
    expect(screen.getByText("Production Kubernetes experience · GAP")).toBeInTheDocument();
  });

  it("does not claim Gate clear for a score-only rough triage result", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FitAssessmentCard
          description="Join a collaborative product team."
          score={68}
          verdict="GOOD"
          eligibility={null}
          matrix={null}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("68/100 · GOOD")).toBeInTheDocument();
    expect(screen.queryByText("Gate clear")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to matrix eligibility when the list-level value is absent", () => {
    const blockedMatrix: FitMatrix = {
      requirements: [
        {
          id: "r1",
          type: "RESPONSIBILITY",
          criticality: "CORE",
          requirement: "Build reliable services",
          judgement: "MATCH",
        },
      ],
      eligibility: {
        status: "BLOCK",
        reasons: ["Confirmed work-rights conflict"],
      },
    };

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FitAssessmentCard
          description="Build reliable services."
          score={29}
          verdict="POOR"
          eligibility={null}
          matrix={blockedMatrix}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Gate blocked");
  });
});
