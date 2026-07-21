import { describe, expect, it } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { mergeAiContentForTarget } from "./mergeAiContentForTarget";

function makeAiContent(label: string): AiContent {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-20T00:00:00.000Z",
    promptMetaHash: `${label}-prompt`,
    source: "local_ai",
    cv: {
      summary: {
        aiText: `${label} summary`,
        originalText: "Base summary",
        accepted: true,
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [
          {
            text: `${label} bullet`,
            accepted: true,
            qualityGate: { passed: true },
          },
        ],
      },
    },
    cover: {
      paragraphOne: { aiText: `${label} cover one`, accepted: true },
      paragraphTwo: { aiText: `${label} cover two`, accepted: true },
      paragraphThree: { aiText: `${label} cover three`, accepted: true },
    },
  };
}

describe("mergeAiContentForTarget", () => {
  it("replaces only CV content when a resume is generated", () => {
    const existing = makeAiContent("existing");
    const incoming = makeAiContent("incoming");

    const merged = mergeAiContentForTarget(existing, incoming, "resume");

    expect(merged.cv).toEqual(incoming.cv);
    expect(merged.cover).toEqual(existing.cover);
    expect(merged.generatedAt).toBe(incoming.generatedAt);
    expect(merged.promptMetaHash).toBe(incoming.promptMetaHash);
    expect(merged.source).toBe(incoming.source);
  });

  it("replaces only cover content when a cover letter is generated", () => {
    const existing = makeAiContent("existing");
    const incoming = makeAiContent("incoming");

    const merged = mergeAiContentForTarget(existing, incoming, "cover");

    expect(merged.cv).toEqual(existing.cv);
    expect(merged.cover).toEqual(incoming.cover);
    expect(merged.generatedAt).toBe(incoming.generatedAt);
    expect(merged.promptMetaHash).toBe(incoming.promptMetaHash);
    expect(merged.source).toBe(incoming.source);
  });

  it("uses incoming content when no compatible draft exists", () => {
    const incoming = makeAiContent("incoming");

    expect(mergeAiContentForTarget(null, incoming, "resume")).toEqual(incoming);
  });
});
