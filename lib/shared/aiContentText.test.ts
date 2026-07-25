import { describe, expect, it } from "vitest";
import {
  acceptedAddedBulletTexts,
  addedBulletText,
  coverParagraphTexts,
  proposalText,
} from "./aiContentText";

describe("aiContentText", () => {
  describe("proposalText", () => {
    it("prefers a user edit over the AI text", () => {
      expect(
        proposalText({ aiText: "AI wrote this", userEdit: "I wrote this" }),
      ).toBe("I wrote this");
    });

    it("falls back to the AI text when the edit is absent or blank", () => {
      expect(proposalText({ aiText: "AI wrote this" })).toBe("AI wrote this");
      expect(proposalText({ aiText: "AI wrote this", userEdit: "   " })).toBe(
        "AI wrote this",
      );
    });

    it("trims both branches, so the same proposal normalizes one way", () => {
      // evidenceLedger trimmed the edit but not the aiText fallback while
      // persistReviewLedger trimmed both. Evidence ids and persisted claims are
      // derived from the same proposal and must not disagree on whitespace.
      expect(proposalText({ aiText: "  padded  " })).toBe("padded");
      expect(proposalText({ aiText: "x", userEdit: "  padded  " })).toBe("padded");
    });

    it("ignores accepted: a replacement cannot be opted out of", () => {
      // Summary and cover paragraphs replace required content. Rejecting one
      // cannot mean omitting it — finalizeApplication throws
      // COVER_PARAGRAPHS_INCOMPLETE on an empty paragraph.
      expect(
        proposalText({ aiText: "still renders", accepted: false }),
      ).toBe("still renders");
    });
  });

  describe("addedBulletText", () => {
    it("reads the bullet's text field and trims both branches", () => {
      expect(addedBulletText({ text: "  base  " })).toBe("base");
      expect(addedBulletText({ text: "base", userEdit: "  edited  " })).toBe(
        "edited",
      );
    });
  });

  describe("acceptedAddedBulletTexts", () => {
    it("keeps only accepted bullets, in order", () => {
      expect(
        acceptedAddedBulletTexts([
          { text: "kept one", accepted: true },
          { text: "rejected", accepted: false },
          { text: "kept two", accepted: true },
        ]),
      ).toEqual(["kept one", "kept two"]);
    });

    it("applies the user edit to an accepted bullet", () => {
      expect(
        acceptedAddedBulletTexts([
          { text: "original", userEdit: "edited", accepted: true },
        ]),
      ).toEqual(["edited"]);
    });

    it("drops an accepted bullet that is empty after trimming", () => {
      expect(
        acceptedAddedBulletTexts([
          { text: "   ", accepted: true },
          { text: "real", accepted: true },
        ]),
      ).toEqual(["real"]);
    });
  });

  describe("coverParagraphTexts", () => {
    it("returns the three body paragraphs in order", () => {
      expect(
        coverParagraphTexts({
          paragraphOne: { aiText: "one", accepted: true },
          paragraphTwo: { aiText: "two", userEdit: "edited two", accepted: true },
          paragraphThree: { aiText: "three", accepted: false },
        }),
      ).toEqual(["one", "edited two", "three"]);
    });
  });
});
