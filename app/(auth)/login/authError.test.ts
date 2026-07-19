import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { getLoginErrorKey, getSafeCallbackUrl } from "./authError";

describe("login recovery", () => {
  it.each([
    [null, null],
    ["AccessDenied", "accessDeniedError"],
    ["OAuthAccountNotLinked", "accountNotLinkedError"],
    ["OAuthCallback", "genericError"],
  ] as const)("maps %s to %s", (error, key) => {
    expect(getLoginErrorKey(error)).toBe(key);
  });

  it.each([
    [null, "/jobs"],
    ["/resume", "/resume"],
    ["/resume/../jobs?sort=newest#top", "/jobs?sort=newest#top"],
    ["https://evil.example", "/jobs"],
    ["//evil.example", "/jobs"],
    ["/\\evil.example", "/jobs"],
    ["/resume/..//evil.example", "/jobs"],
    ["/..//evil.example", "/jobs"],
    ["/a/../\\evil.example", "/jobs"],
    ["/login", "/jobs"],
    ["/login?callbackUrl=/login", "/jobs"],
    ["/api/auth/signin", "/jobs"],
    ["javascript:alert(1)", "/jobs"],
  ] as const)("normalizes callback %s to %s", (value, expected) => {
    expect(getSafeCallbackUrl(value)).toBe(expected);
  });

  it("rejects a backslash origin after query decoding", () => {
    const value = new URLSearchParams("callbackUrl=%2F%5Cevil.example").get("callbackUrl");

    expect(value).toBe("/\\evil.example");
    expect(getSafeCallbackUrl(value)).toBe("/jobs");
  });

  it.each([
    [
      "en",
      en.loginPage,
      "Start with Joblit",
      "Sign in with Google or GitHub. Your free account is created automatically.",
    ],
    [
      "zh",
      zh.loginPage,
      "开始使用 Joblit",
      "使用 Google 或 GitHub 登录，系统会自动创建你的免费账号。",
    ],
  ] as const)("uses open-account copy in %s", (_locale, messages, heading, subtitle) => {
    expect(messages.welcomeBack).toBe(heading);
    expect(messages.subtitle).toBe(subtitle);
  });

  it("keeps English and Chinese login keys aligned", () => {
    expect(Object.keys(zh.loginPage).sort()).toEqual(Object.keys(en.loginPage).sort());
  });

  it.each([
    ["en", en.loginPage],
    ["zh", zh.loginPage],
  ] as const)("provides distinct recovery messages without invitation keys in %s", (_locale, messages) => {
    const copy = messages as Record<string, string>;
    expect(copy.accessDeniedError).toEqual(expect.any(String));
    expect(copy.accountNotLinkedError).toEqual(expect.any(String));
    expect(copy.accessDeniedError.trim()).not.toBe("");
    expect(copy.accountNotLinkedError.trim()).not.toBe("");
    expect(copy.accessDeniedError).not.toBe(copy.genericError);
    expect(copy.accountNotLinkedError).not.toBe(copy.genericError);
    expect(messages).not.toHaveProperty("deniedTitle");
    expect(messages).not.toHaveProperty("deniedBody");
    expect(messages).not.toHaveProperty("requestAccess");
    expect(messages).not.toHaveProperty("tryAnother");
  });
});
