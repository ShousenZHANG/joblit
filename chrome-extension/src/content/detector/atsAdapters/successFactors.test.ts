import { describe, it, expect } from "vitest";
import { successFactorsAdapter } from "./successFactors";

describe("successFactorsAdapter", () => {
  describe("canHandle", () => {
    it("matches successfactors.com URLs", () => {
      expect(successFactorsAdapter.canHandle("https://career.successfactors.com/apply")).toBe(true);
    });

    it("matches subdomain successfactors URLs", () => {
      expect(successFactorsAdapter.canHandle("https://company.successfactors.com/career")).toBe(true);
    });

    it("matches sap.com career URLs", () => {
      expect(successFactorsAdapter.canHandle("https://jobs.sap.com/en/career/apply/12345")).toBe(true);
    });

    it("rejects non-SuccessFactors URLs", () => {
      expect(successFactorsAdapter.canHandle("https://example.com/jobs")).toBe(false);
    });
  });

  describe("detectFields", () => {
    it("returns empty when no apply form found", () => {
      document.body.innerHTML = "<div>No form</div>";
      expect(successFactorsAdapter.detectFields(document)).toEqual([]);
    });

    it("detects fields from #applyFormContainer", () => {
      document.body.innerHTML = `
        <div id="applyFormContainer">
          <label for="fn">First Name</label>
          <input id="fn" name="firstName" type="text" />
          <label for="ln">Last Name</label>
          <input id="ln" name="lastName" type="text" />
        </div>
      `;

      const fields = successFactorsAdapter.detectFields(document);
      expect(fields.length).toBe(2);
    });

    it("detects fields from named applyForm", () => {
      document.body.innerHTML = `
        <form name="applyForm">
          <input name="phone" type="tel" />
          <textarea name="coverLetter"></textarea>
          <input type="submit" value="Apply" />
        </form>
      `;

      const fields = successFactorsAdapter.detectFields(document);
      expect(fields.length).toBe(2);
    });
  });
});
