import { describe, it, expect } from "vitest";
import { leverAdapter } from "./lever";

describe("leverAdapter", () => {
  describe("canHandle", () => {
    it("matches jobs.lever.co URLs", () => {
      expect(leverAdapter.canHandle("https://jobs.lever.co/company/abc-123")).toBe(true);
    });

    it("rejects non-Lever URLs", () => {
      expect(leverAdapter.canHandle("https://example.com/jobs")).toBe(false);
      expect(leverAdapter.canHandle("https://boards.greenhouse.io/company")).toBe(false);
    });
  });

  describe("detectFields", () => {
    it("returns empty when no application form found", () => {
      document.body.innerHTML = "<div>No form here</div>";
      expect(leverAdapter.detectFields(document)).toEqual([]);
    });

    it("detects fields from data-qa application form", () => {
      document.body.innerHTML = `
        <form data-qa="application-form">
          <label for="name">Full Name</label>
          <input id="name" name="name" type="text" />
          <label for="email">Email</label>
          <input id="email" name="email" type="email" />
          <input type="hidden" name="_token" />
          <input type="submit" value="Submit" />
        </form>
      `;

      const fields = leverAdapter.detectFields(document);
      expect(fields.length).toBe(2);
      expect(fields.every((f) => f.inputType !== "hidden")).toBe(true);
    });

    it("detects fields from .application-form class", () => {
      document.body.innerHTML = `
        <form class="application-form">
          <label for="phone">Phone</label>
          <input id="phone" name="phone" type="tel" />
        </form>
      `;

      const fields = leverAdapter.detectFields(document);
      expect(fields.length).toBe(1);
      expect(fields[0].name).toBe("phone");
    });

    it("excludes button-type inputs", () => {
      document.body.innerHTML = `
        <form data-qa="application-form">
          <input name="name" type="text" />
          <input type="button" value="Cancel" />
          <button type="submit">Apply</button>
        </form>
      `;

      const fields = leverAdapter.detectFields(document);
      expect(fields.length).toBe(1);
    });
  });
});
