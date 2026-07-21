import { describe, expect, it } from "vitest";
import {
  aiContentSchema,
  hashAiContent,
  AI_CONTENT_SCHEMA_VERSION,
} from "./aiContent";

describe("aiContentSchema", () => {
  function validAiContent() {
    return {
      schemaVersion: AI_CONTENT_SCHEMA_VERSION,
      generatedAt: "2026-05-06T00:00:00.000Z",
      promptMetaHash: "sha256:abc123",
      cv: {
        summary: {
          aiText: "AI rewrite",
          originalText: "Original summary",
        },
        latestExperience: {
          experienceIndex: 0,
          addedBullets: [
            {
              text: "AI proposed bullet",
              accepted: true,
              qualityGate: { passed: true },
            },
          ],
        },
      },
      cover: {
        paragraphOne: { aiText: "Hook", accepted: true },
        paragraphTwo: { aiText: "Match", accepted: true },
        paragraphThree: { aiText: "Close", accepted: true },
      },
    };
  }

  it("accepts a fully-populated aiContent", () => {
    const result = aiContentSchema.safeParse(validAiContent());
    expect(result.success).toBe(true);
  });

  it("accepts bounded import provenance without changing the DB schema", () => {
    const value = { ...validAiContent(), source: "local_ai" as const };
    expect(aiContentSchema.parse(value).source).toBe("local_ai");
  });

  it("rejects a payload with an unknown schemaVersion", () => {
    const stale = { ...validAiContent(), schemaVersion: 999 };
    const result = aiContentSchema.safeParse(stale);
    expect(result.success).toBe(false);
  });

  it("reads a row written before skillsAdditions was retired", () => {
    const legacy = validAiContent();
    (legacy.cv as Record<string, unknown>).skillsAdditions = [
      { label: "Backend", items: ["Spring Boot"], accepted: true },
    ];

    const result = aiContentSchema.safeParse(legacy);

    expect(result.success).toBe(true);
    expect(result.success && "skillsAdditions" in result.data.cv).toBe(false);
  });

  it("still rejects unknown keys inside cv", () => {
    const tampered = validAiContent();
    (tampered.cv as Record<string, unknown>).surprise = 1;
    expect(aiContentSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects unknown top-level keys (catch typos)", () => {
    const tampered = { ...validAiContent(), surprise: 1 } as unknown;
    const result = aiContentSchema.safeParse(tampered);
    expect(result.success).toBe(false);
  });

  it("hashAiContent returns a stable hash for equivalent payloads", () => {
    const a = validAiContent();
    const b = validAiContent();
    expect(hashAiContent(a)).toBe(hashAiContent(b));
  });

  it("hashAiContent changes when a single bullet flips accepted", () => {
    const a = validAiContent();
    const b = validAiContent();
    b.cv.latestExperience.addedBullets[0]!.accepted = false;
    expect(hashAiContent(a)).not.toBe(hashAiContent(b));
  });
});
