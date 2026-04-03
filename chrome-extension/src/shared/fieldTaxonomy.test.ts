import { describe, it, expect } from "vitest";
import {
  FieldCategory,
  LABEL_PATTERNS,
  PROFILE_KEY_MAP,
} from "./fieldTaxonomy";

/** Helper: find which category a label text matches. */
function classifyLabel(text: string): FieldCategory {
  for (const [category, patterns] of Object.entries(LABEL_PATTERNS)) {
    if (patterns.some((p: RegExp) => p.test(text))) {
      return category as FieldCategory;
    }
  }
  return FieldCategory.UNKNOWN;
}

describe("LABEL_PATTERNS", () => {
  describe("English labels", () => {
    const cases: [string, FieldCategory][] = [
      ["Full Name", FieldCategory.FULL_NAME],
      ["full name", FieldCategory.FULL_NAME],
      ["Your Name", FieldCategory.FULL_NAME],
      ["Name", FieldCategory.FULL_NAME],
      ["First Name", FieldCategory.FIRST_NAME],
      ["Given Name", FieldCategory.FIRST_NAME],
      ["Last Name", FieldCategory.LAST_NAME],
      ["Surname", FieldCategory.LAST_NAME],
      ["Email", FieldCategory.EMAIL],
      ["E-mail", FieldCategory.EMAIL],
      ["email address", FieldCategory.EMAIL],
      ["Phone", FieldCategory.PHONE],
      ["Mobile", FieldCategory.PHONE],
      ["Cell Phone", FieldCategory.PHONE],
      ["LinkedIn", FieldCategory.LINKEDIN_URL],
      ["LinkedIn Profile", FieldCategory.LINKEDIN_URL],
      ["GitHub", FieldCategory.GITHUB_URL],
      ["Portfolio", FieldCategory.PORTFOLIO_URL],
      ["Website", FieldCategory.WEBSITE_URL],
      ["Personal URL", FieldCategory.WEBSITE_URL],
      ["Current Company", FieldCategory.CURRENT_COMPANY],
      ["Current Title", FieldCategory.CURRENT_TITLE],
      ["Job Title", FieldCategory.CURRENT_TITLE],
      ["School", FieldCategory.SCHOOL_NAME],
      ["University", FieldCategory.SCHOOL_NAME],
      ["Degree", FieldCategory.DEGREE],
      ["GPA", FieldCategory.GPA],
      ["Resume", FieldCategory.RESUME_UPLOAD],
      ["Cover Letter", FieldCategory.COVER_LETTER_UPLOAD],
      ["Years of Experience", FieldCategory.YEARS_EXPERIENCE],
      ["Desired Salary", FieldCategory.DESIRED_SALARY],
      ["Gender", FieldCategory.GENDER],
    ];

    it.each(cases)("classifies '%s' as %s", (label, expected) => {
      expect(classifyLabel(label)).toBe(expected);
    });
  });

  describe("Chinese labels", () => {
    const cases: [string, FieldCategory][] = [
      ["姓名", FieldCategory.FULL_NAME],
      ["邮箱", FieldCategory.EMAIL],
      ["电子邮件", FieldCategory.EMAIL],
      ["手机", FieldCategory.PHONE],
      ["电话", FieldCategory.PHONE],
      ["微信", FieldCategory.WECHAT],
      ["学校", FieldCategory.SCHOOL_NAME],
      ["学历", FieldCategory.DEGREE],
      ["专业", FieldCategory.MAJOR],
      ["性别", FieldCategory.GENDER],
      ["年龄", FieldCategory.AGE],
      ["简历", FieldCategory.RESUME_UPLOAD],
      ["求职信", FieldCategory.COVER_LETTER_UPLOAD],
      ["当前公司", FieldCategory.CURRENT_COMPANY],
      ["到岗时间", FieldCategory.AVAILABILITY],
    ];

    it.each(cases)("classifies '%s' as %s", (label, expected) => {
      expect(classifyLabel(label)).toBe(expected);
    });
  });

  it("returns UNKNOWN for unrecognized labels", () => {
    expect(classifyLabel("foobar_xyz_123")).toBe(FieldCategory.UNKNOWN);
    expect(classifyLabel("")).toBe(FieldCategory.UNKNOWN);
  });

  it("every category has a pattern array (even if empty)", () => {
    for (const cat of Object.values(FieldCategory)) {
      expect(LABEL_PATTERNS[cat]).toBeDefined();
      expect(Array.isArray(LABEL_PATTERNS[cat])).toBe(true);
    }
  });
});

describe("PROFILE_KEY_MAP", () => {
  it("maps core fields to flat profile keys", () => {
    expect(PROFILE_KEY_MAP[FieldCategory.FULL_NAME]).toBe("fullName");
    expect(PROFILE_KEY_MAP[FieldCategory.EMAIL]).toBe("email");
    expect(PROFILE_KEY_MAP[FieldCategory.PHONE]).toBe("phone");
    expect(PROFILE_KEY_MAP[FieldCategory.LINKEDIN_URL]).toBe("linkedinUrl");
    expect(PROFILE_KEY_MAP[FieldCategory.GITHUB_URL]).toBe("githubUrl");
    expect(PROFILE_KEY_MAP[FieldCategory.CURRENT_COMPANY]).toBe("currentCompany");
    expect(PROFILE_KEY_MAP[FieldCategory.SCHOOL_NAME]).toBe("schoolName");
  });

  it("does not map UNKNOWN", () => {
    expect(PROFILE_KEY_MAP[FieldCategory.UNKNOWN]).toBeUndefined();
  });

  it("does not map file upload fields", () => {
    expect(PROFILE_KEY_MAP[FieldCategory.RESUME_UPLOAD]).toBeUndefined();
    expect(PROFILE_KEY_MAP[FieldCategory.COVER_LETTER_UPLOAD]).toBeUndefined();
  });
});
