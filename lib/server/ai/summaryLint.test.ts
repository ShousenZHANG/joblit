import { describe, expect, it } from "vitest";
import {
  lintGeneratedSummary,
  profileTextForLint,
  requiredTitlePhrase,
} from "./summaryLint";

const PROFILE = {
  summary: "Engineer who ships.",
  skills: [{ category: "AI", items: ["TypeScript", "ReactJS", "Docker"] }],
  experiences: [
    {
      company: "Acme",
      bullets: ["Built agents used by 10+ staff", "Ran 2,100 automated tests"],
    },
  ],
};

const profileText = profileTextForLint(PROFILE);

function lint(summary: string, jobTitle = "AI Engineer") {
  return lintGeneratedSummary({ summary, jobTitle, profileText });
}

describe("requiredTitlePhrase", () => {
  it("strips trailing qualifiers and seniority words", () => {
    expect(requiredTitlePhrase("Senior AI Engineer - Platform (12 month)")).toBe(
      "ai engineer",
    );
    expect(requiredTitlePhrase("Junior Software Engineer")).toBe(
      "software engineer",
    );
  });

  it("returns null when only a level word remains", () => {
    expect(requiredTitlePhrase("Intern")).toBeNull();
  });
});

describe("lintGeneratedSummary", () => {
  it("passes a summary that names the role and restates profile facts", () => {
    expect(
      lint("AI Engineer building agents used by 10+ staff, backed by 2,100 tests."),
    ).toEqual({ ok: true });
  });

  it("accepts the role without claiming the posting's seniority", () => {
    expect(lint("AI Engineer shipping TypeScript services.", "Senior AI Engineer")).toEqual(
      { ok: true },
    );
  });

  it("rejects a summary that never names the role", () => {
    expect(lint("Software developer who ships production systems.")).toEqual({
      ok: false,
      failure: { kind: "title_missing", requiredTitle: "ai engineer" },
    });
  });

  it("skips the title rule when the posting title carries no role noun", () => {
    expect(lint("Builds production systems in TypeScript.", "Intern")).toEqual({
      ok: true,
    });
  });

  it("rejects a number the profile cannot support", () => {
    expect(lint("AI Engineer who cut latency by 45%.")).toEqual({
      ok: false,
      failure: { kind: "ungrounded_number", token: "45%" },
    });
  });

  it("matches numbers across separator styles", () => {
    expect(lint("AI Engineer backed by 2100 automated tests.")).toEqual({
      ok: true,
    });
  });

  it("rejects a skill the profile never claims", () => {
    expect(lint("AI Engineer working in Kubernetes.")).toEqual({
      ok: false,
      failure: { kind: "ungrounded_skill", skill: "Kubernetes" },
    });
  });

  it("matches skills through gazetteer aliases", () => {
    expect(lint("AI Engineer working in React.")).toEqual({ ok: true });
  });
});
