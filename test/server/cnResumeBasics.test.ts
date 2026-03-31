import { describe, it, expect } from "vitest";
import { CnResumeBasicsSchema } from "@/lib/shared/schemas/resumeProfile";

const minimal = {
  fullName: "张三",
  title: "软件工程师",
  email: "zhangsan@example.com",
  phone: "13800138000",
};

const full = {
  ...minimal,
  location: "北京市海淀区",
  photoUrl: "https://example.com/photo.jpg",
  gender: "男",
  age: "28",
  identity: "3年经验",
  availabilityMonth: "2026-03",
  wechat: "zhangsan_wx",
  qq: "123456789",
};

describe("CnResumeBasicsSchema", () => {
  it("accepts full CN basics (all fields filled)", () => {
    const result = CnResumeBasicsSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.age).toBe("28");
      expect(result.data.identity).toBe("3年经验");
      expect(result.data.availabilityMonth).toBe("2026-03");
      expect(result.data.wechat).toBe("zhangsan_wx");
      expect(result.data.qq).toBe("123456789");
    }
  });

  it("accepts minimal basics (only required fields)", () => {
    const result = CnResumeBasicsSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("rejects missing fullName", () => {
    const { fullName, ...rest } = minimal;
    expect(CnResumeBasicsSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing title", () => {
    const { title, ...rest } = minimal;
    expect(CnResumeBasicsSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing email", () => {
    const { email, ...rest } = minimal;
    expect(CnResumeBasicsSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing phone", () => {
    const { phone, ...rest } = minimal;
    expect(CnResumeBasicsSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = CnResumeBasicsSchema.safeParse({ ...minimal, email: "bad" });
    expect(result.success).toBe(false);
  });

  it("validates photoUrl is a valid URL when provided", () => {
    const valid = CnResumeBasicsSchema.safeParse({
      ...minimal,
      photoUrl: "https://example.com/photo.jpg",
    });
    expect(valid.success).toBe(true);

    const empty = CnResumeBasicsSchema.safeParse({
      ...minimal,
      photoUrl: "",
    });
    expect(empty.success).toBe(true);

    const invalid = CnResumeBasicsSchema.safeParse({
      ...minimal,
      photoUrl: "not-a-url",
    });
    expect(invalid.success).toBe(false);
  });
});
