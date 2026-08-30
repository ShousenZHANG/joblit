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

  // A posting that hires several people puts the count in the title. Left in,
  // the count becomes part of the phrase the summary is required to contain,
  // and rule 2 then reads that digit as a fabricated number — the two rules
  // contradict each other and no summary can satisfy both. Found by the eval
  // harness on a real posting: "AI Engineer x 2".
  it("strips the headcount a posting appends to the role", () => {
    expect(requiredTitlePhrase("AI Engineer x 2")).toBe("ai engineer");
    expect(requiredTitlePhrase("AI Engineer x2")).toBe("ai engineer");
    expect(requiredTitlePhrase("Data Analyst X 3")).toBe("data analyst");
    expect(requiredTitlePhrase("2 x Backend Engineer")).toBe("backend engineer");
  });

  it("keeps a trailing token that is part of the role, not a count", () => {
    expect(requiredTitlePhrase("Engineer Level 2")).toBe("engineer level 2");
    expect(requiredTitlePhrase("Support Engineer Tier 3")).toBe(
      "support engineer tier 3",
    );
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

  it("lets a multi-hire posting be satisfied without claiming its count", () => {
    expect(lint("AI Engineer shipping agents.", "AI Engineer x 2")).toEqual({
      ok: true,
    });
  });
});
