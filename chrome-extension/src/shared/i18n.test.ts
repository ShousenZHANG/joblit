import { describe, it, expect, afterEach } from "vitest";
import { t, setLocale, getLocale } from "./i18n";

describe("i18n", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("returns English by default", () => {
    expect(t("app.name")).toBe("Jobflow AutoFill");
  });

  it("returns Chinese after setLocale('zh')", () => {
    setLocale("zh");
    expect(t("app.name")).toBe("Jobflow 自动填充");
  });

  it("returns the key for unknown messages", () => {
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("replaces {placeholder} params", () => {
    expect(t("history.fieldsFilled", { filled: 3, total: 5 })).toBe("3/5 fields filled");
  });

  it("replaces Chinese placeholders", () => {
    setLocale("zh");
    expect(t("history.fieldsFilled", { filled: 3, total: 5 })).toBe("已填充 3/5 个字段");
  });

  it("getLocale returns current locale", () => {
    expect(getLocale()).toBe("en");
    setLocale("zh");
    expect(getLocale()).toBe("zh");
  });
});
