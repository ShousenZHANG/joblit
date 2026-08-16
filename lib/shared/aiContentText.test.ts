import { describe, expect, it } from "vitest";
import {
  coverParagraphTexts,
  effectiveSkillsSelection,
  proposalText,
  resolveSkillsSelection,
} from "./aiContentText";

const masterSkills = [
  { category: "Languages", items: ["TypeScript", "Python", "Go"] },
  { category: "Cloud", items: ["AWS", "Terraform"] },
  { category: "Testing", items: ["Vitest", "Playwright"] },
];

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
      // The renderers, the review panel and the document content hash all
      // describe the same document, so they must not disagree on whitespace.
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

  describe("effectiveSkillsSelection", () => {
    it("ships the user's selection once they have narrowed the AI's", () => {
      expect(
        effectiveSkillsSelection({
          aiSelection: [{ group: 0, items: [0, 1] }],
          userSelection: [{ group: 0, items: [1] }],
        }),
      ).toEqual([{ group: 0, items: [1] }]);
    });

    it("ships the AI selection while the user has made no override", () => {
      expect(
        effectiveSkillsSelection({ aiSelection: [{ group: 2, items: [0] }] }),
      ).toEqual([{ group: 2, items: [0] }]);
    });
  });

  describe("resolveSkillsSelection", () => {
    it("reorders and narrows the master profile's own skills", () => {
      expect(
        resolveSkillsSelection(masterSkills, {
          aiSelection: [
            { group: 1, items: [1, 0] },
            { group: 0, items: [2] },
          ],
        }),
      ).toEqual([
        { category: "Cloud", items: ["Terraform", "AWS"] },
        { category: "Languages", items: ["Go"] },
      ]);
    });

    it("resolves the user's override rather than the AI's selection", () => {
      expect(
        resolveSkillsSelection(masterSkills, {
          aiSelection: [{ group: 0, items: [0, 1, 2] }],
          userSelection: [{ group: 0, items: [0] }],
        }),
      ).toEqual([{ category: "Languages", items: ["TypeScript"] }]);
    });

    it("skips an index that no longer resolves after a profile edit", () => {
      // A profile edit between generation and finalize is a normal event; the
      // render context fence un-publishes the document, so the correct
      // behaviour here is to render whatever still resolves rather than throw.
      expect(
        resolveSkillsSelection(masterSkills, {
          aiSelection: [
            { group: 9, items: [0] },
            { group: 0, items: [0, 7] },
            { group: 2, items: [5] },
          ],
        }),
      ).toEqual([{ category: "Languages", items: ["TypeScript"] }]);
    });

    it("adds nothing the master profile does not already hold", () => {
      const resolved = resolveSkillsSelection(masterSkills, {
        aiSelection: [
          { group: 0, items: [0, 1, 2] },
          { group: 1, items: [0, 1] },
          { group: 2, items: [0, 1] },
        ],
      });
      const owned = new Set(masterSkills.flatMap((group) => group.items));
      for (const group of resolved) {
        for (const item of group.items) expect(owned.has(item)).toBe(true);
      }
    });

    it("returns the master profile unchanged when the selection is absent", () => {
      // A draft written before tailoring selected skills. It kept rendering the
      // profile's own skills and must keep rendering the same document.
      const resolved = resolveSkillsSelection(masterSkills, undefined);
      expect(resolved).toEqual(masterSkills);
      expect(resolved).not.toBe(masterSkills);
    });
  });
});
