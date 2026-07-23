import { describe, expect, it } from "vitest";
import {
  canonicalizeLatestBullets,
  isGroundedAddedBullet,
  isNonRedundantAddedBullet,
} from "./manualImportParser";

/**
 * The Quality Gate — the filters that decide whether an AI-added bullet is
 * shown enabled in the Edit panel.
 *
 * These were reachable only through `buildManualImportArtifact`, whose test
 * asserts the resulting AI Content rather than the gate's boundaries, so the
 * thresholds themselves were unexercised. A threshold nobody tests is a
 * threshold nobody can change safely.
 */

const BASE = [
  "Built a TypeScript service on AWS Lambda handling 40k requests per day",
  "Migrated the reporting pipeline from Redshift to Snowflake",
];

describe("isGroundedAddedBullet", () => {
  it("accepts a bullet that shares vocabulary with the base experience", () => {
    expect(
      isGroundedAddedBullet(
        "Extended the TypeScript service on AWS with request batching",
        BASE,
      ),
    ).toBe(true);
  });

  it("rejects a bullet invented from nothing in the base experience", () => {
    expect(
      isGroundedAddedBullet("Led negotiations with retail partners in Osaka", BASE),
    ).toBe(false);
  });

  it("rejects an empty or whitespace bullet", () => {
    expect(isGroundedAddedBullet("", BASE)).toBe(false);
    expect(isGroundedAddedBullet("   ", BASE)).toBe(false);
  });

  it("rejects everything when there is no base experience to ground against", () => {
    expect(isGroundedAddedBullet("Built a TypeScript service on AWS", [])).toBe(false);
  });

  it("rejects a bullet made only of stopwords", () => {
    expect(isGroundedAddedBullet("and the of with for", BASE)).toBe(false);
  });

  it("grounds on two shared terms even when overall similarity is low", () => {
    // The gate passes on `bestSharedTokens >= 2` OR `bestScore >= 0.28`; this
    // exercises the first arm, where a long bullet dilutes the Jaccard score.
    const wordy =
      "Snowflake and Redshift knowledge applied while mentoring six analysts " +
      "across three quarters of quarterly planning workshops and reviews";
    expect(isGroundedAddedBullet(wordy, BASE)).toBe(true);
  });
});

describe("isNonRedundantAddedBullet", () => {
  it("accepts a bullet that adds new terms", () => {
    expect(
      isNonRedundantAddedBullet(
        "Introduced OpenTelemetry tracing across the ingestion workers",
        BASE,
        [],
      ),
    ).toBe(true);
  });

  it("rejects a near-restatement of an existing bullet", () => {
    expect(
      isNonRedundantAddedBullet(
        "Built a TypeScript service on AWS Lambda handling 40k requests daily",
        BASE,
        [],
      ),
    ).toBe(false);
  });

  it("rejects a restatement of a bullet accepted earlier in the same pass", () => {
    const accepted = ["Introduced OpenTelemetry tracing across ingestion workers"];
    expect(
      isNonRedundantAddedBullet(
        "Introduced OpenTelemetry tracing for the ingestion workers",
        BASE,
        accepted,
      ),
    ).toBe(false);
  });

  it("accepts anything when there is nothing to compare against", () => {
    expect(isNonRedundantAddedBullet("Anything at all", [], [])).toBe(true);
  });

  it("rejects a bullet carrying no meaningful keywords", () => {
    // Keywords are tokens of four or more characters that are not stopwords.
    expect(isNonRedundantAddedBullet("did it all on my own", BASE, [])).toBe(false);
  });
});

describe("canonicalizeLatestBullets", () => {
  it("keeps a base bullet the model echoed back verbatim out of the added set", () => {
    const result = canonicalizeLatestBullets(BASE, [BASE[0], "A genuinely new bullet"]);

    expect(result.addedBullets).toEqual(["A genuinely new bullet"]);
    expect(result.canonicalBullets).toContain(BASE[0]);
  });

  it("treats a formatting-only difference as the same bullet", () => {
    const reformatted = `**${BASE[0]}**`;
    const result = canonicalizeLatestBullets(BASE, [reformatted]);

    expect(result.addedBullets).toEqual([]);
  });

  it("matches each base bullet at most once", () => {
    // A model that repeats one base bullet twice must not consume two slots —
    // the duplicate is an addition, and the gates get to judge it.
    const result = canonicalizeLatestBullets(BASE, [BASE[0], BASE[0]]);

    expect(result.addedBullets).toHaveLength(1);
  });
});
