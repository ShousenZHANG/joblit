import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

const dependencies = vi.hoisted(() => ({
  compileLatexToPdf: vi.fn(),
  getResumeProfile: vi.fn(),
  mapResumeProfile: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/lib/server/latex/compilePdf", () => ({
  compileLatexToPdf: dependencies.compileLatexToPdf,
}));
vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: dependencies.getResumeProfile,
}));
vi.mock("@/lib/server/latex/mapResumeProfile", () => ({
  mapResumeProfile: dependencies.mapResumeProfile,
}));

import {
  buildAtsKeywords,
  renderApplicationPdf,
  renderCoverLetterPdf,
} from "./finalizeApplication";

const aiContent: AiContent = {
  schemaVersion: 2,
  generatedAt: "2026-07-20T00:00:00.000Z",
  promptMetaHash: "sha256:test",
  cv: {
    summary: {
      aiText: "Security-focused engineer",
      originalText: "Engineer",
      accepted: true,
    },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

describe("renderApplicationPdf", () => {
  beforeEach(() => {
    dependencies.compileLatexToPdf.mockReset();
    dependencies.getResumeProfile.mockReset().mockResolvedValue({});
    dependencies.mapResumeProfile.mockReset().mockReturnValue({
      candidate: {
        name: "Jane Doe",
        title: "Engineer",
        email: "jane@example.com",
        phone: "+61 400 000 000",
        linkedinUrl: "https://linkedin.com/in/jane",
        linkedinText: "linkedin.com/in/jane",
      },
      summary: "Engineer",
      skills: [{ label: "Core", items: ["TypeScript"] }],
      experiences: [],
      projects: [],
      education: [],
    });
    dependencies.compileLatexToPdf.mockResolvedValue(Buffer.from("%PDF"));
  });

  // The AI no longer contributes skills, so the only path into the skills
  // section is the master profile, which mapResumeProfile has already escaped.
  it("renders the master-profile skills section untouched", async () => {
    await renderApplicationPdf({
      applicationId: "application-1",
      userId: "user-1",
      aiContent,
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Joblit",
        market: "AU",
      },
    });

    const tex = dependencies.compileLatexToPdf.mock.calls[0]?.[0] as string;
    expect(tex).toContain("TypeScript");
  });

  it("loads the Application-linked profile instead of the current active profile", async () => {
    await renderApplicationPdf({
      applicationId: "application-1",
      userId: "user-1",
      resumeProfileId: "profile-linked",
      aiContent,
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Joblit",
        market: "AU",
      },
    });

    expect(dependencies.getResumeProfile).toHaveBeenCalledWith("user-1", {
      profileId: "profile-linked",
      locale: "en-AU",
    });
  });

  it("uses the same Application-linked profile for cover letters", async () => {
    await renderCoverLetterPdf({
      applicationId: "application-1",
      userId: "user-1",
      resumeProfileId: "profile-linked",
      aiContent,
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Joblit",
        market: "AU",
      },
    });

    expect(dependencies.getResumeProfile).toHaveBeenCalledWith("user-1", {
      profileId: "profile-linked",
      locale: "en-AU",
    });
  });

  it("renders both documents from the supplied Profile snapshot without re-reading mutable state", async () => {
    const profileSnapshot = {
      summary: "Snapshot summary",
      basics: { fullName: "Snapshot Candidate" },
      links: null,
      skills: null,
      experiences: null,
      projects: null,
      education: null,
    };

    await renderApplicationPdf({
      applicationId: "application-1",
      userId: "user-1",
      resumeProfileId: "profile-linked",
      profileSnapshot,
      aiContent,
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Joblit",
        market: "AU",
      },
    });
    await renderCoverLetterPdf({
      applicationId: "application-1",
      userId: "user-1",
      resumeProfileId: "profile-linked",
      profileSnapshot,
      aiContent,
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Joblit",
        market: "AU",
      },
    });

    expect(dependencies.getResumeProfile).not.toHaveBeenCalled();
    expect(dependencies.mapResumeProfile).toHaveBeenNthCalledWith(
      1,
      profileSnapshot,
    );
    expect(dependencies.mapResumeProfile).toHaveBeenNthCalledWith(
      2,
      profileSnapshot,
    );
  });

  /**
   * ADR-0001's composition rule, as it now stands: `userEdit ?? aiText` for the
   * summary, the skills selection resolved against the master profile, and the
   * experience section rendered exactly as the candidate wrote it.
   *
   * Every fixture above uses `experiences: []`, so no branch of that rule ran
   * in any test — the thing the ADR exists to protect was uncovered. These
   * drive it with real values and read the TeX `renderResumeTex` produced.
   */
  describe("the ADR-0001 composition rule", () => {
    const withExperience = {
      candidate: {
        name: "Jane Doe",
        title: "Engineer",
        email: "jane@example.com",
        phone: "+61 400 000 000",
        linkedinUrl: "https://linkedin.com/in/jane",
        linkedinText: "linkedin.com/in/jane",
      },
      summary: "Profile summary",
      skills: [
        { label: "Core", items: ["TypeScript", "Node.js"] },
        { label: "Cloud", items: ["AWS"] },
      ],
      experiences: [
        {
          company: "Acme",
          title: "Engineer",
          location: "Sydney",
          dates: "2024",
          links: [],
          bullets: ["Base bullet"],
        },
        {
          company: "Globex",
          title: "Engineer",
          location: "Melbourne",
          dates: "2022",
          links: [],
          bullets: ["Older bullet"],
        },
      ],
      projects: [],
      education: [],
    };

    async function renderTex(content: AiContent): Promise<string> {
      dependencies.mapResumeProfile.mockReturnValue(withExperience);
      await renderApplicationPdf({
        applicationId: "application-1",
        userId: "user-1",
        aiContent: content,
        job: { id: "job-1", title: "Engineer", company: "Joblit", market: "AU" },
      });
      return dependencies.compileLatexToPdf.mock.calls.at(-1)?.[0] as string;
    }

    it("prefers the user's edit over the AI summary", async () => {
      const tex = await renderTex({
        ...aiContent,
        cv: {
          ...aiContent.cv,
          summary: { ...aiContent.cv.summary, userEdit: "Edited by the user" },
        },
      });

      expect(tex).toContain("Edited by the user");
      expect(tex).not.toContain("Security-focused engineer");
    });

    it("falls back to the profile summary when both are blank", async () => {
      const tex = await renderTex({
        ...aiContent,
        cv: {
          ...aiContent.cv,
          summary: { aiText: "   ", originalText: "Engineer", accepted: true },
        },
      });

      expect(tex).toContain("Profile summary");
    });

    it("renders every experience bullet exactly as the candidate wrote it", async () => {
      // Tailoring writes no bullets. The master profile owns this section
      // outright, so both experiences survive a resume render untouched.
      const tex = await renderTex({
        ...aiContent,
        cv: {
          summary: { ...aiContent.cv.summary, userEdit: "Edited by the user" },
          skillsSelection: { aiSelection: [{ group: 1, items: [0] }] },
        },
      });

      expect(tex).toContain("Base bullet");
      expect(tex).toContain("Older bullet");
    });

    it("renders the selected skills in the tailored order", async () => {
      const tex = await renderTex({
        ...aiContent,
        cv: {
          ...aiContent.cv,
          skillsSelection: {
            aiSelection: [
              { group: 1, items: [0] },
              { group: 0, items: [1] },
            ],
          },
        },
      });

      expect(tex).toContain("AWS");
      expect(tex).toContain("Node.js");
      // Narrowed out of the Core group by the selection.
      expect(tex).not.toContain("TypeScript");
      expect(tex.indexOf("AWS")).toBeLessThan(tex.indexOf("Node.js"));
    });

    it("renders the user's narrowed selection over the AI's", async () => {
      const tex = await renderTex({
        ...aiContent,
        cv: {
          ...aiContent.cv,
          skillsSelection: {
            aiSelection: [{ group: 0, items: [0, 1] }],
            userSelection: [{ group: 1, items: [0] }],
          },
        },
      });

      expect(tex).toContain("AWS");
      expect(tex).not.toContain("TypeScript");
      expect(tex).not.toContain("Node.js");
    });

    it("renders the whole master skills section when there is no selection", async () => {
      const tex = await renderTex(aiContent);

      expect(tex).toContain("TypeScript");
      expect(tex).toContain("Node.js");
      expect(tex).toContain("AWS");
    });
  });

  /**
   * The keyword list a rendered PDF must contain to count as on-target. It used
   * to also mine the review ledger's extracted requirements; the title was
   * always the load-bearing half, and the summary lint now guarantees the
   * tailored summary states it.
   */
  describe("buildAtsKeywords", () => {
    it("reads its keywords from the job title alone", () => {
      expect(buildAtsKeywords("Senior Platform Engineer")).toEqual([
        "Senior",
        "Platform",
        "Engineer",
      ]);
    });

    it("splits on the separators a posting bolts onto a title", () => {
      expect(buildAtsKeywords("Data Engineer - Analytics/Reporting (Remote)")).toEqual(
        ["Data", "Engineer", "Analytics", "Reporting", "Remote"],
      );
    });

    it("drops short tokens and repeats so the ATS check stays meaningful", () => {
      expect(buildAtsKeywords("QA Engineer, Engineer of AI")).toEqual([
        "Engineer",
      ]);
    });

    it("caps the list at thirty keywords", () => {
      const title = Array.from({ length: 40 }, (_, i) => `Keyword${i}`).join(" ");
      expect(buildAtsKeywords(title)).toHaveLength(30);
    });
  });

  describe("when the Master Resume Profile is gone", () => {
    // Deleting the profile between draft and finalize used to throw
    // `new Error("MASTER_PROFILE_MISSING")`, which the finalize route did not
    // rescue — the user got an opaque 500 with no code, while the same failure
    // was a typed 404 on the manual path.
    beforeEach(() => dependencies.getResumeProfile.mockResolvedValue(null));

    it("fails the resume render with a typed 404", async () => {
      await expect(
        renderApplicationPdf({
          applicationId: "application-1",
          userId: "user-1",
          resumeProfileId: "profile-linked",
          aiContent,
          job: { id: "job-1", title: "Engineer", company: "Joblit", market: "AU" },
        }),
      ).rejects.toMatchObject({ code: "NO_PROFILE", status: 404 });
    });

    it("fails the cover render with a typed 404", async () => {
      await expect(
        renderCoverLetterPdf({
          applicationId: "application-1",
          userId: "user-1",
          resumeProfileId: "profile-linked",
          aiContent,
          job: { id: "job-1", title: "Engineer", company: "Joblit", market: "AU" },
        }),
      ).rejects.toMatchObject({ code: "NO_PROFILE", status: 404 });
    });
  });
});
