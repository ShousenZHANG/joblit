import { describe, expect, it } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import {
  hashApplicationDocumentContent as hashWithRenderContext,
  projectApplicationPublication as projectWithRenderContext,
  rebaseApplicationPublicationForRenderContext,
  transitionApplicationPublication as transitionWithRenderContext,
  type ApplicationPublicationRenderContext,
} from "./applicationPublication";

const RENDER_CONTEXT: ApplicationPublicationRenderContext = {
  available: true,
  resume: { profile: "profile-v1", locale: "en-AU" },
  cover: { candidate: "candidate-v1", job: "job-v1", locale: "en-AU" },
};

function hashApplicationDocumentContent(
  aiContent: AiContent,
  target: "resume" | "cover",
) {
  return hashWithRenderContext(aiContent, target, RENDER_CONTEXT);
}

function projectApplicationPublication(
  input: Omit<
    Parameters<typeof projectWithRenderContext>[0],
    "renderContext"
  >,
) {
  return projectWithRenderContext({ ...input, renderContext: RENDER_CONTEXT });
}

function transitionApplicationPublication(
  input: Omit<
    Parameters<typeof transitionWithRenderContext>[0],
    "renderContext"
  >,
) {
  return transitionWithRenderContext({
    ...input,
    renderContext: RENDER_CONTEXT,
  });
}

function content(): AiContent {
  return {
    schemaVersion: 2,
    generatedAt: "2026-07-28T00:00:00.000Z",
    promptMetaHash: "sha256:test",
    cv: {
      summary: {
        aiText: "Platform engineer",
        originalText: "Engineer",
        accepted: true,
      },
      skillsSelection: { aiSelection: [{ group: 0, items: [1, 0] }] },
    },
    cover: {
      paragraphOne: { aiText: "One", accepted: true },
      paragraphTwo: { aiText: "Two", accepted: true },
      paragraphThree: { aiText: "Three", accepted: true },
    },
  };
}

function emptyRecord() {
  return {
    status: "DRAFT" as const,
    aiContentHash: "aggregate-v1",
    resumePdfUrl: null,
    coverPdfUrl: null,
    resumeContentHash: null,
    coverContentHash: null,
    resumePublishedHash: null,
    coverPublishedHash: null,
  };
}

describe("Application publication", () => {
  it("hashes only the render-effective content for the selected document", () => {
    const initial = content();
    const resumeHash = hashApplicationDocumentContent(initial, "resume");
    const coverHash = hashApplicationDocumentContent(initial, "cover");
    const reviewOnlyChange = {
      ...initial,
      review: {
        verdict: "pass" as const,
        reviewedAt: "2026-07-28T00:00:00.000Z",
        coveragePercent: 100,
        requirements: [],
        issues: [],
      },
    };

    expect(hashApplicationDocumentContent(reviewOnlyChange, "resume")).toBe(
      resumeHash,
    );
    expect(hashApplicationDocumentContent(reviewOnlyChange, "cover")).toBe(
      coverHash,
    );

    const editedCover = structuredClone(initial);
    editedCover.cover.paragraphTwo.userEdit = "Edited two";
    expect(hashApplicationDocumentContent(editedCover, "resume")).toBe(
      resumeHash,
    );
    expect(hashApplicationDocumentContent(editedCover, "cover")).not.toBe(
      coverHash,
    );
  });

  it("invalidates a publication when a real render dependency changes", () => {
    const initial = content();
    const changedResumeContext = {
      ...RENDER_CONTEXT,
      resume: { profile: "profile-v2", locale: "en-AU" },
    };
    const changedCoverContext = {
      ...RENDER_CONTEXT,
      cover: { candidate: "candidate-v1", job: "job-v2", locale: "en-AU" },
    };

    expect(
      hashWithRenderContext(initial, "resume", changedResumeContext),
    ).not.toBe(hashApplicationDocumentContent(initial, "resume"));
    expect(
      hashWithRenderContext(initial, "cover", changedCoverContext),
    ).not.toBe(hashApplicationDocumentContent(initial, "cover"));
  });

  it("rebases each target independently when external render inputs change", () => {
    const initial = content();
    const resumeHash = hashApplicationDocumentContent(initial, "resume");
    const coverHash = hashApplicationDocumentContent(initial, "cover");
    const record = {
      ...emptyRecord(),
      status: "FINAL" as const,
      resumePdfUrl: "https://blob.example/resume.pdf",
      coverPdfUrl: "https://blob.example/cover.pdf",
      resumeContentHash: resumeHash,
      resumePublishedHash: resumeHash,
      coverContentHash: coverHash,
      coverPublishedHash: coverHash,
    };
    const nextRenderContext = {
      ...RENDER_CONTEXT,
      resume: { profile: "profile-v2", locale: "en-AU" },
    };

    const result = rebaseApplicationPublicationForRenderContext({
      aiContent: initial,
      record,
      previousRenderContext: RENDER_CONTEXT,
      nextRenderContext,
    });

    const nextResumeHash = hashWithRenderContext(
      initial,
      "resume",
      nextRenderContext,
    );
    expect(result.publication).toMatchObject({
      status: "DRAFT",
      resume: {
        status: "DRAFT",
        contentHash: nextResumeHash,
        publishedHash: resumeHash,
      },
      cover: {
        status: "FINAL",
        contentHash: coverHash,
        publishedHash: coverHash,
      },
    });
    expect(result.persistence).toEqual({
      status: "DRAFT",
      resumeContentHash: nextResumeHash,
      resumePublishedHash: resumeHash,
      coverContentHash: coverHash,
      coverPublishedHash: coverHash,
    });
  });

  it("invalidates both targets when their effective locale changes", () => {
    const initial = content();
    const resumeHash = hashApplicationDocumentContent(initial, "resume");
    const coverHash = hashApplicationDocumentContent(initial, "cover");
    const nextRenderContext = {
      available: true,
      resume: { profile: "profile-v1", locale: "zh-CN" },
      cover: {
        candidate: "candidate-v1",
        job: "job-v1",
        locale: "zh-CN",
      },
    };

    const result = rebaseApplicationPublicationForRenderContext({
      aiContent: initial,
      record: {
        ...emptyRecord(),
        status: "FINAL",
        resumePdfUrl: "https://blob.example/resume.pdf",
        coverPdfUrl: "https://blob.example/cover.pdf",
        resumeContentHash: resumeHash,
        resumePublishedHash: resumeHash,
        coverContentHash: coverHash,
        coverPublishedHash: coverHash,
      },
      previousRenderContext: RENDER_CONTEXT,
      nextRenderContext,
    });

    expect(result.publication).toMatchObject({
      status: "DRAFT",
      resume: { status: "DRAFT", publishedHash: resumeHash },
      cover: { status: "DRAFT", publishedHash: coverHash },
    });
  });

  it("keeps Resume final when only Cover changes", () => {
    const initial = content();
    const resumeHash = hashApplicationDocumentContent(initial, "resume");
    const coverHash = hashApplicationDocumentContent(initial, "cover");
    expect(resumeHash).not.toBeNull();
    expect(coverHash).not.toBeNull();

    const previous = {
      ...emptyRecord(),
      resumePdfUrl: "https://blob.example/resume.pdf",
      coverPdfUrl: "https://blob.example/cover.pdf",
      resumeContentHash: resumeHash,
      coverContentHash: coverHash,
      resumePublishedHash: resumeHash,
      coverPublishedHash: coverHash,
      status: "FINAL" as const,
    };
    const edited = structuredClone(initial);
    edited.cover.paragraphTwo.userEdit = "Edited two";

    const result = transitionApplicationPublication({
      previousAiContent: initial,
      previous,
      nextAiContent: edited,
      publishedTargets: [],
    });

    expect(result.publication.resume.status).toBe("FINAL");
    expect(result.publication.cover.status).toBe("DRAFT");
    expect(result.publication.status).toBe("DRAFT");
    expect(result.persistence.resumePublishedHash).toBe(resumeHash);
    expect(result.persistence.coverPublishedHash).toBe(coverHash);
  });

  it("publishes targets independently and becomes final only when every present target is final", () => {
    const initial = content();
    const resumeOnly = transitionApplicationPublication({
      previousAiContent: null,
      previous: emptyRecord(),
      nextAiContent: initial,
      publishedTargets: ["resume"],
      nextUrls: { resume: "https://blob.example/resume.pdf" },
    });

    expect(resumeOnly.publication.resume.status).toBe("FINAL");
    expect(resumeOnly.publication.cover.status).toBe("DRAFT");
    expect(resumeOnly.publication.status).toBe("DRAFT");

    const both = transitionApplicationPublication({
      previousAiContent: initial,
      previous: {
        ...emptyRecord(),
        ...resumeOnly.persistence,
        resumePdfUrl: "https://blob.example/resume.pdf",
      },
      nextAiContent: initial,
      publishedTargets: ["cover"],
      nextUrls: { cover: "https://blob.example/cover.pdf" },
    });

    expect(both.publication.resume.status).toBe("FINAL");
    expect(both.publication.cover.status).toBe("FINAL");
    expect(both.publication.status).toBe("FINAL");
  });

  it("treats a missing optional document as neutral in the aggregate projection", () => {
    const resumeOnly = content();
    resumeOnly.cover.paragraphOne.aiText = "";
    resumeOnly.cover.paragraphTwo.aiText = "";
    resumeOnly.cover.paragraphThree.aiText = "";

    const result = transitionApplicationPublication({
      previousAiContent: null,
      previous: emptyRecord(),
      nextAiContent: resumeOnly,
      publishedTargets: ["resume"],
      nextUrls: { resume: "https://blob.example/resume.pdf" },
    });

    expect(result.publication.resume.status).toBe("FINAL");
    expect(result.publication.cover.status).toBe("MISSING");
    expect(result.publication.status).toBe("FINAL");
  });

  it("keeps legacy aggregate-versioned PDFs draft without target render proof", () => {
    const initial = content();
    const legacy = {
      ...emptyRecord(),
      status: "FINAL" as const,
      aiContentHash: "aggregate-v1",
      resumePdfUrl:
        "https://blob.example/applications/resume.aggregate-v1.pdf",
      coverPdfUrl: "https://blob.example/unversioned-cover.pdf",
    };

    const publication = projectApplicationPublication({
      aiContent: initial,
      record: legacy,
    });

    expect(publication.resume.status).toBe("DRAFT");
    expect(publication.resume.publishedHash).toBeNull();
    expect(publication.cover.status).toBe("DRAFT");
    expect(publication.cover.publishedHash).toBeNull();
  });

  it("does not prove a legacy PDF when its render inputs are unavailable", () => {
    const initial = content();
    const legacyHash = "b".repeat(64);
    const publication = projectWithRenderContext({
      aiContent: initial,
      record: {
        ...emptyRecord(),
        aiContentHash: legacyHash,
        resumePdfUrl: `https://blob.example/applications/resume.${legacyHash}.pdf`,
      },
      renderContext: {
        available: false,
        resume: { unavailable: true },
        cover: { unavailable: true },
      },
    });

    expect(publication.resume.status).toBe("DRAFT");
    expect(publication.resume.publishedHash).toBeNull();
  });

  it("closes the generate, publish, re-edit, and re-publish lifecycle", () => {
    const generated = content();
    const resumePublished = transitionApplicationPublication({
      previousAiContent: null,
      previous: emptyRecord(),
      nextAiContent: generated,
      publishedTargets: ["resume"],
      nextUrls: { resume: "https://blob.example/resume-v1.pdf" },
    });
    expect(resumePublished.publication).toMatchObject({
      status: "DRAFT",
      resume: { status: "FINAL" },
      cover: { status: "DRAFT" },
    });

    const editedCover = structuredClone(generated);
    editedCover.cover.paragraphTwo.userEdit = "Edited cover";
    const coverDraft = transitionApplicationPublication({
      previousAiContent: generated,
      previous: {
        ...emptyRecord(),
        ...resumePublished.persistence,
        resumePdfUrl: "https://blob.example/resume-v1.pdf",
      },
      nextAiContent: editedCover,
      publishedTargets: [],
    });
    expect(coverDraft.publication.resume.status).toBe("FINAL");

    const coverPublished = transitionApplicationPublication({
      previousAiContent: editedCover,
      previous: {
        ...emptyRecord(),
        ...coverDraft.persistence,
        resumePdfUrl: "https://blob.example/resume-v1.pdf",
      },
      nextAiContent: editedCover,
      publishedTargets: ["cover"],
      nextUrls: { cover: "https://blob.example/cover-v1.pdf" },
    });
    expect(coverPublished.publication.status).toBe("FINAL");

    const reEditedResume = structuredClone(editedCover);
    reEditedResume.cv.summary.userEdit = "Re-edited resume";
    const resumeDraft = transitionApplicationPublication({
      previousAiContent: editedCover,
      previous: {
        ...emptyRecord(),
        ...coverPublished.persistence,
        resumePdfUrl: "https://blob.example/resume-v1.pdf",
        coverPdfUrl: "https://blob.example/cover-v1.pdf",
      },
      nextAiContent: reEditedResume,
      publishedTargets: [],
    });
    expect(resumeDraft.publication).toMatchObject({
      status: "DRAFT",
      resume: { status: "DRAFT" },
      cover: { status: "FINAL" },
    });

    const republished = transitionApplicationPublication({
      previousAiContent: reEditedResume,
      previous: {
        ...emptyRecord(),
        ...resumeDraft.persistence,
        resumePdfUrl: "https://blob.example/resume-v1.pdf",
        coverPdfUrl: "https://blob.example/cover-v1.pdf",
      },
      nextAiContent: reEditedResume,
      publishedTargets: ["resume"],
      nextUrls: { resume: "https://blob.example/resume-v2.pdf" },
    });
    expect(republished.publication).toMatchObject({
      status: "FINAL",
      resume: { status: "FINAL" },
      cover: { status: "FINAL" },
    });
  });
});
