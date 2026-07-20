import { describe, expect, it } from "vitest";
import {
  buildSimilarityShingles,
  computeSimHash64,
  isNearDuplicateSimHash,
  isWithinSimHashWindow,
  simHashHammingDistance,
  simHashSimilarity,
  similarityTokens,
} from "@/lib/server/jobs/simHash";

describe("CJK-compatible 64-bit SimHash", () => {
  it("builds word trigrams for English and character trigrams for Chinese", () => {
    expect(buildSimilarityShingles("build reliable distributed systems")).toEqual([
      "build\u001freliable\u001fdistributed",
      "reliable\u001fdistributed\u001fsystems",
    ]);
    expect(similarityTokens("高级后端工程师")).toEqual([
      "高",
      "级",
      "后",
      "端",
      "工",
      "程",
      "师",
    ]);
    expect(buildSimilarityShingles("高级后端工程师")[0]).toBe("高\u001f级\u001f后");
  });

  it("returns a stable JSON-safe 64-bit fingerprint", () => {
    const fingerprint = computeSimHash64(
      "Design build and operate reliable distributed backend systems",
    );
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(
      computeSimHash64(
        "Design build and operate reliable distributed backend systems",
      ),
    ).toBe(fingerprint);
    expect(computeSimHash64(" \n\t ")).toBeNull();
  });

  it("scores small English and Chinese edits as similar", () => {
    const englishA = computeSimHash64(
      "Design build operate and monitor reliable distributed backend services using TypeScript PostgreSQL AWS Kubernetes observability and automated testing. Partner with product security and platform teams to improve performance availability deployment safety incident response documentation mentoring and engineering standards",
    )!;
    const englishB = computeSimHash64(
      "Design build operate and monitor reliable distributed backend services using TypeScript PostgreSQL AWS Kubernetes observability and integration testing. Partner with product security and platform teams to improve performance availability deployment safety incident response documentation mentoring and engineering standards",
    )!;
    const chineseA = computeSimHash64(
      "负责设计开发维护高可用分布式后端服务优化数据库性能建设自动化测试与监控体系参与需求评审系统设计代码审查故障复盘容量规划安全治理持续交付并与产品数据平台团队协作推动工程质量和业务稳定性持续提升",
    )!;
    const chineseB = computeSimHash64(
      "负责设计开发维护高可用分布式后端系统优化数据库性能建设自动化测试与监控体系参与需求评审系统设计代码审查故障复盘容量规划安全治理持续交付并与产品数据平台团队协作推动工程质量和业务稳定性持续提升",
    )!;

    expect(simHashSimilarity(englishA, englishB)).toBeGreaterThanOrEqual(0.92);
    // Character n-grams make unspaced CJK comparable instead of returning an
    // empty fingerprint. At 64 bits, one short-document edit need not cross
    // the intentionally strict 0.92 production duplicate threshold.
    expect(simHashSimilarity(chineseA, chineseB)).toBeGreaterThan(0.8);
    expect(isNearDuplicateSimHash(englishA, englishB)).toBe(true);
  });

  it("keeps unrelated descriptions apart", () => {
    const backend = computeSimHash64(
      "Build distributed backend APIs with Java Kubernetes PostgreSQL observability",
    )!;
    const designer = computeSimHash64(
      "Create visual brand campaigns illustrations typography and motion design",
    )!;
    expect(simHashSimilarity(backend, designer)).toBeLessThan(0.92);
  });

  it("computes Hamming distance and validates fingerprints", () => {
    expect(simHashHammingDistance("0000000000000000", "ffffffffffffffff")).toBe(
      64,
    );
    expect(() => simHashHammingDistance("bad", "ffffffffffffffff")).toThrow(
      /16 hexadecimal/i,
    );
  });

  it("enforces the default 90-day comparison window", () => {
    expect(
      isWithinSimHashWindow("2026-01-01T00:00:00Z", "2026-03-31T00:00:00Z"),
    ).toBe(true);
    expect(
      isWithinSimHashWindow("2026-01-01T00:00:00Z", "2026-04-02T00:00:00Z"),
    ).toBe(false);
    expect(isWithinSimHashWindow("bad", "2026-01-01")).toBe(false);
    expect(
      isWithinSimHashWindow(
        "2026-01-01T00:00:00Z",
        "2026-04-02T00:00:00Z",
        Number.POSITIVE_INFINITY,
      ),
    ).toBe(false);
  });
});
