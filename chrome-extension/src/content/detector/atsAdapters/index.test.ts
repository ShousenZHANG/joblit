import { describe, it, expect, beforeEach } from "vitest";
import { getAdapter } from "./index";

/** Create a Document-like object with a custom location.href but real DOM methods. */
function mockDoc(href: string): Document {
  return new Proxy(document, {
    get(target, prop) {
      if (prop === "location") return { href };
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("getAdapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("returns greenhouse adapter for greenhouse URLs", () => {
    expect(getAdapter(mockDoc("https://boards.greenhouse.io/company/jobs/123")).name).toBe("greenhouse");
  });

  it("returns lever adapter for lever URLs", () => {
    expect(getAdapter(mockDoc("https://jobs.lever.co/company/abc")).name).toBe("lever");
  });

  it("returns workday adapter for workday URLs", () => {
    expect(getAdapter(mockDoc("https://company.wd5.myworkdayjobs.com/jobs/123")).name).toBe("workday");
  });

  it("returns icims adapter for icims URLs", () => {
    expect(getAdapter(mockDoc("https://careers-company.icims.com/jobs/12345")).name).toBe("icims");
  });

  it("returns successfactors adapter for successfactors URLs", () => {
    expect(getAdapter(mockDoc("https://career.successfactors.com/apply")).name).toBe("successfactors");
  });

  it("returns generic adapter for unknown URLs", () => {
    expect(getAdapter(mockDoc("https://example.com/careers")).name).toBe("generic");
  });

  it("prefers specific adapter over generic", () => {
    const adapter = getAdapter(mockDoc("https://jobs.lever.co/bigcompany"));
    expect(adapter.name).toBe("lever");
  });
});
