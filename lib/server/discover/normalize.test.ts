import { describe, it, expect } from "vitest";
import {
  normalizeUrl,
  trigramJaccard,
  tokenJaccard,
  hybridSimilarity,
} from "./normalize";

// ── normalizeUrl ──

describe("normalizeUrl", () => {
  it("lowercases the hostname", () => {
    expect(normalizeUrl("https://GitHub.COM/foo/bar")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("strips www prefix", () => {
    expect(normalizeUrl("https://www.example.com/path")).toBe(
      "https://example.com/path",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe(
      "https://example.com/path",
    );
  });

  it("removes common tracking params (utm_*, ref, source)", () => {
    expect(
      normalizeUrl(
        "https://example.com/page?utm_source=twitter&utm_medium=social&id=42",
      ),
    ).toBe("https://example.com/page?id=42");
  });

  it("removes all params if only tracking params exist", () => {
    expect(
      normalizeUrl("https://example.com/page?utm_source=twitter&ref=abc"),
    ).toBe("https://example.com/page");
  });

  it("preserves meaningful query params", () => {
    expect(normalizeUrl("https://example.com/search?q=hello&page=2")).toBe(
      "https://example.com/search?page=2&q=hello",
    );
  });

  it("sorts query params for consistent keys", () => {
    const a = normalizeUrl("https://example.com/?b=2&a=1");
    const b = normalizeUrl("https://example.com/?a=1&b=2");
    expect(a).toBe(b);
  });

  it("handles URLs without protocol gracefully", () => {
    expect(normalizeUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("returns original string for non-URL input", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

// ── trigramJaccard ──

describe("trigramJaccard", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramJaccard("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(trigramJaccard("aaa", "zzz")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially similar strings", () => {
    const score = trigramJaccard(
      "machine learning tutorial",
      "machine learning guide",
    );
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1);
  });

  it("handles empty strings", () => {
    expect(trigramJaccard("", "")).toBe(0);
    expect(trigramJaccard("abc", "")).toBe(0);
  });
});

// ── tokenJaccard ──

describe("tokenJaccard", () => {
  it("returns 1 for identical token sets", () => {
    expect(tokenJaccard("hello world foo", "hello world foo")).toBe(1);
  });

  it("ignores stopwords (the, a, is, in, of, to, and, for, on, with, at, by)", () => {
    const score = tokenJaccard(
      "the guide to machine learning",
      "a guide for machine learning",
    );
    // After removing stopwords: "guide machine learning" vs "guide machine learning"
    expect(score).toBe(1);
  });

  it("ignores single-character tokens", () => {
    expect(tokenJaccard("a b c hello", "x y z hello")).toBe(1);
  });

  it("is case insensitive", () => {
    expect(tokenJaccard("Hello World", "hello world")).toBe(1);
  });

  it("returns 0 for no token overlap", () => {
    expect(tokenJaccard("alpha beta", "gamma delta")).toBe(0);
  });
});

// ── hybridSimilarity ──

describe("hybridSimilarity", () => {
  it("returns the max of trigram and token Jaccard", () => {
    const score = hybridSimilarity(
      "Introduction to Deep Learning with PyTorch",
      "Introduction to Deep Learning using PyTorch",
    );
    // Should be high — very similar texts
    expect(score).toBeGreaterThan(0.6);
  });

  it("detects near-duplicates above 0.7 threshold", () => {
    const score = hybridSimilarity(
      "OpenAI releases GPT-5 model with improved reasoning",
      "OpenAI releases GPT-5 with improved reasoning capabilities",
    );
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it("returns low score for unrelated texts", () => {
    const score = hybridSimilarity(
      "React server components deep dive",
      "Rust memory safety borrow checker",
    );
    expect(score).toBeLessThan(0.3);
  });
});
