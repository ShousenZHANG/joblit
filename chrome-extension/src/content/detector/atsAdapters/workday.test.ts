import { describe, it, expect } from "vitest";
import { workdayAdapter } from "./workday";

describe("workdayAdapter", () => {
  describe("canHandle", () => {
    it("matches myworkdayjobs.com URLs", () => {
      expect(workdayAdapter.canHandle("https://company.myworkdayjobs.com/en-US/jobs/job/city/title", document)).toBe(true);
    });

    it("matches wd-prefixed URLs", () => {
      expect(workdayAdapter.canHandle("https://company.wd5.myworkdayjobs.com/jobs", document)).toBe(true);
    });

    it("matches workday.com job URLs", () => {
      expect(workdayAdapter.canHandle("https://company.workday.com/en-US/job/12345", document)).toBe(true);
    });

    it("rejects non-Workday URLs", () => {
      expect(workdayAdapter.canHandle("https://example.com/jobs", document)).toBe(false);
      expect(workdayAdapter.canHandle("https://jobs.lever.co/company", document)).toBe(false);
    });
  });

  describe("detectFields", () => {
    it("returns empty when no job application container found", () => {
      document.body.innerHTML = "<div>No form here</div>";
      expect(workdayAdapter.detectFields(document)).toEqual([]);
    });

    it("detects fields from jobApplicationContainer", () => {
      document.body.innerHTML = `
        <div data-automation-id="jobApplicationContainer">
          <label for="firstName">First Name</label>
          <input id="firstName" name="firstName" type="text" />
          <label for="lastName">Last Name</label>
          <input id="lastName" name="lastName" type="text" />
          <input type="hidden" name="csrf" />
        </div>
      `;

      const fields = workdayAdapter.detectFields(document);
      expect(fields.length).toBe(2);
    });

    it("detects fields from applyForm container", () => {
      document.body.innerHTML = `
        <div data-automation-id="applyForm">
          <label for="email">Email Address</label>
          <input id="email" name="email" type="email" />
        </div>
      `;

      const fields = workdayAdapter.detectFields(document);
      expect(fields.length).toBe(1);
      expect(fields[0].name).toBe("email");
    });

    it("deduplicates wrapper + inner input pairs", () => {
      document.body.innerHTML = `
        <div data-automation-id="jobApplicationContainer">
          <div data-automation-id="phoneInput">
            <input name="phone" type="tel" />
          </div>
        </div>
      `;

      const fields = workdayAdapter.detectFields(document);
      // Should deduplicate: wrapper matches [data-automation-id$="Input"],
      // but the inner <input> also matches the standard input selector
      expect(fields.length).toBe(1);
      expect(fields[0].name).toBe("phone");
    });

    it("detects combobox role elements", () => {
      document.body.innerHTML = `
        <div data-automation-id="jobApplicationContainer">
          <div role="combobox">
            <input name="country" type="text" placeholder="Select country" />
          </div>
        </div>
      `;

      const fields = workdayAdapter.detectFields(document);
      expect(fields.length).toBe(1);
      expect(fields[0].name).toBe("country");
    });
  });
});
