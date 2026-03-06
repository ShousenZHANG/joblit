import { describe, it, expect } from "vitest";
import { parseCnSalary } from "@/lib/shared/parseCnSalary";

describe("parseCnSalary", () => {
  it("parses K range", () => {
    expect(parseCnSalary("25-50K")).toEqual({ min: 25000, max: 50000, currency: "CNY" });
  });

  it("parses lowercase k range", () => {
    expect(parseCnSalary("15-25k")).toEqual({ min: 15000, max: 25000, currency: "CNY" });
  });

  it("parses K range with bonus months", () => {
    expect(parseCnSalary("25-50K·15薪")).toEqual({ min: 25000, max: 50000, currency: "CNY", months: 15 });
  });

  it("parses 万/月 format", () => {
    expect(parseCnSalary("2.5-5万/月")).toEqual({ min: 25000, max: 50000, currency: "CNY" });
  });

  it("parses 万 format without /月", () => {
    expect(parseCnSalary("3-6万")).toEqual({ min: 30000, max: 60000, currency: "CNY" });
  });

  it("returns null for 面议", () => {
    expect(parseCnSalary("面议")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCnSalary("")).toBeNull();
  });
});
