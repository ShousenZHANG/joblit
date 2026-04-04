import { describe, it, expect } from "vitest";
import { icimsAdapter } from "./icims";

describe("icimsAdapter", () => {
  describe("canHandle", () => {
    it("matches icims.com URLs", () => {
      expect(icimsAdapter.canHandle("https://careers-company.icims.com/jobs/12345", document)).toBe(true);
    });

    it("matches URLs with .icims. subdomain", () => {
      expect(icimsAdapter.canHandle("https://company.icims.com/apply", document)).toBe(true);
    });

    it("matches pages with iCIMS meta generator tag", () => {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "generator");
      meta.setAttribute("content", "iCIMS Career Portal");
      document.head.appendChild(meta);

      expect(icimsAdapter.canHandle("https://careers.example.com/apply", document)).toBe(true);
      meta.remove();
    });

    it("rejects non-iCIMS URLs without meta tag", () => {
      expect(icimsAdapter.canHandle("https://example.com/jobs", document)).toBe(false);
    });
  });

  describe("detectFields", () => {
    it("returns empty when no iCIMS form found", () => {
      document.body.innerHTML = "<div>No form</div>";
      expect(icimsAdapter.detectFields(document)).toEqual([]);
    });

    it("detects fields from .iCIMS_Forms container", () => {
      document.body.innerHTML = `
        <div class="iCIMS_Forms">
          <label for="fname">First Name</label>
          <input id="fname" name="firstName" type="text" />
          <label for="lname">Last Name</label>
          <input id="lname" name="lastName" type="text" />
          <input type="hidden" name="token" />
        </div>
      `;

      const fields = icimsAdapter.detectFields(document);
      expect(fields.length).toBe(2);
    });

    it("detects fields from form with icims action", () => {
      document.body.innerHTML = `
        <form action="https://example.icims.com/submit">
          <input name="email" type="email" />
        </form>
      `;

      const fields = icimsAdapter.detectFields(document);
      expect(fields.length).toBe(1);
    });
  });
});
