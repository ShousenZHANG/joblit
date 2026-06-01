import { describe, it, expect } from "vitest";
import {
  isNowcoderUrl,
  parseNowcoderTitle,
  extractCnCity,
  enrichNowcoderJob,
} from "./nowcoder";
import type { RawCnJob } from "../types";

function row(over: Partial<RawCnJob> = {}): RawCnJob {
  return {
    jobUrl: "https://www.nowcoder.com/jobs/detail/123",
    title: "字节跳动 | 后端开发工程师",
    company: null,
    location: null,
    jobType: null,
    jobLevel: null,
    description: "<div>岗位职责... 工作地点：上海 薪资 25k</div>",
    publishedAt: null,
    source: "rsshub",
    ...over,
  };
}

describe("isNowcoderUrl", () => {
  it("matches nowcoder hosts", () => {
    expect(isNowcoderUrl("https://www.nowcoder.com/jobs/detail/1")).toBe(true);
    expect(isNowcoderUrl("https://nowcoder.com/x")).toBe(true);
  });
  it("rejects other hosts and junk", () => {
    expect(isNowcoderUrl("https://v2ex.com/t/1")).toBe(false);
    expect(isNowcoderUrl("not-a-url")).toBe(false);
    expect(isNowcoderUrl("https://nowcoder.com.evil.com/x")).toBe(false);
  });
});

describe("parseNowcoderTitle", () => {
  it("splits 'Company | Title' on a half-width bar", () => {
    expect(parseNowcoderTitle("字节跳动 | 后端开发工程师")).toEqual({
      company: "字节跳动",
      title: "后端开发工程师",
    });
  });
  it("splits on a full-width bar", () => {
    expect(parseNowcoderTitle("阿里巴巴｜前端工程师")).toEqual({
      company: "阿里巴巴",
      title: "前端工程师",
    });
  });
  it("falls back to the whole string when there is no bar", () => {
    expect(parseNowcoderTitle("后端开发工程师")).toEqual({
      company: null,
      title: "后端开发工程师",
    });
  });
});

describe("extractCnCity", () => {
  it("finds a city in the description", () => {
    expect(extractCnCity("工作地点：上海，全职")).toBe("上海");
    expect(extractCnCity("<p>深圳 · 社招</p>")).toBe("深圳");
  });
  it("returns null when no known city is present", () => {
    expect(extractCnCity("远程办公")).toBeNull();
    expect(extractCnCity(null)).toBeNull();
  });
});

describe("enrichNowcoderJob", () => {
  it("pulls company from the title and city from the description", () => {
    const out = enrichNowcoderJob(row());
    expect(out.company).toBe("字节跳动");
    expect(out.title).toBe("后端开发工程师");
    expect(out.location).toBe("上海");
  });
  it("is a no-op for non-nowcoder rows", () => {
    const input = row({ jobUrl: "https://v2ex.com/t/1", title: "A | B" });
    expect(enrichNowcoderJob(input)).toEqual(input);
  });
  it("does not overwrite a company/location already present", () => {
    const out = enrichNowcoderJob(row({ company: "已知公司", location: "北京" }));
    expect(out.company).toBe("已知公司");
    expect(out.location).toBe("北京");
  });
});
