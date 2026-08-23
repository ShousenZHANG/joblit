import { describe, expect, it } from "vitest";
import {
  detectLinkBrand,
  isPlausibleEmail,
  isPlausibleUrl,
  suggestLinkLabel,
  extractUrls,
} from "./linkBrand";

describe("link brand detection", () => {
  it("recognises a host with or without scheme, www, or path", () => {
    expect(detectLinkBrand("https://www.linkedin.com/in/eddy")).toBe("linkedin");
    expect(detectLinkBrand("github.com/ShousenZHANG")).toBe("github");
    expect(suggestLinkLabel("https://x.com/eddy")).toBe("X");
    expect(suggestLinkLabel("https://twitter.com/eddy")).toBe("X");
  });

  it("matches subdomains but never substrings", () => {
    expect(detectLinkBrand("https://gist.github.com/eddy")).toBe("github");
    // A lookalike host must not borrow another brand's mark.
    expect(detectLinkBrand("https://github.com.evil.io/eddy")).toBe("generic");
    expect(detectLinkBrand("https://notgithub.com/eddy")).toBe("generic");
    expect(suggestLinkLabel("https://github.com.evil.io/eddy")).toBeNull();
  });

  it("falls back to generic for unknown or unparseable input", () => {
    expect(detectLinkBrand("")).toBe("generic");
    expect(detectLinkBrand("eddyzhang.me")).toBe("generic");
    expect(suggestLinkLabel("not a url at all")).toBeNull();
  });
});

describe("quiet field validation", () => {
  it("accepts bare hosts and full URLs, rejects only the impossible", () => {
    // Empty is never an error: the hint appears on blur, and a resume field
    // the user has not filled in yet is not a mistake.
    expect(isPlausibleUrl("")).toBe(true);
    expect(isPlausibleUrl("eddyzhang.me")).toBe(true);
    expect(isPlausibleUrl("https://www.linkedin.com/in/eddy?ref=1")).toBe(true);
    expect(isPlausibleUrl("not a url")).toBe(false);
    expect(isPlausibleUrl("justtext")).toBe(false);
  });

  it("flags an email only once it cannot be one", () => {
    expect(isPlausibleEmail("")).toBe(true);
    expect(isPlausibleEmail("eddy@example.com")).toBe(true);
    expect(isPlausibleEmail("eddy@")).toBe(false);
    expect(isPlausibleEmail("eddy example.com")).toBe(false);
  });
});

describe("extractUrls", () => {
  it("takes every address out of a pasted block, in order", () => {
    expect(
      extractUrls("github.com/me\nhttps://example.com/cv  linkedin.com/in/me"),
    ).toEqual(["github.com/me", "https://example.com/cv", "linkedin.com/in/me"]);
  });

  it("ignores prose and anything without a host", () => {
    expect(extractUrls("see my work at")).toEqual([]);
    expect(extractUrls("call me on 0400 000 000")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
  });

  it("drops the punctuation a URL picks up from a sentence", () => {
    expect(extractUrls("my repo (github.com/me), and my site example.com.")).toEqual([
      "github.com/me",
      "example.com",
    ]);
  });

  it("collapses duplicates so one link cannot eat two of the few slots", () => {
    expect(extractUrls("github.com/me github.com/ME")).toEqual(["github.com/me"]);
  });
});
