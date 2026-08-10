import { beforeEach, describe, expect, it, vi } from "vitest";

const resumeProfileStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
}));

const activeResumeProfileStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

const applicationStore = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

const executeRawStore = vi.hoisted(() => vi.fn());
const queryRawStore = vi.hoisted(() => vi.fn());

const transactionStore = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    resumeProfile: resumeProfileStore,
    activeResumeProfile: activeResumeProfileStore,
    application: applicationStore,
    $executeRaw: executeRawStore,
    $queryRaw: queryRawStore,
    $transaction: transactionStore.run,
  },
}));

import {
  createResumeProfile,
  deleteResumeProfile,
  getResumeProfile,
  listResumeProfiles,
  setActiveResumeProfile,
  upsertResumeProfile,
} from "@/lib/server/resumeProfile";
import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
} from "@/lib/server/applications/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

function aiContent(): AiContent {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-28T00:00:00.000Z",
    promptMetaHash: "profile-publication-test",
    cv: {
      summary: {
        aiText: "Tailored summary",
        originalText: "Original summary",
        accepted: true,
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [{ text: "Tailored bullet", accepted: true }],
      },
    },
    cover: {
      paragraphOne: { aiText: "First paragraph", accepted: true },
      paragraphTwo: { aiText: "Second paragraph", accepted: true },
      paragraphThree: { aiText: "Third paragraph", accepted: true },
    },
  };
}

function storedProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "rp-linked",
    userId: "user-1",
    name: "Primary CV",
    revision: 1,
    locale: "en-AU",
    summary: "Platform engineer",
    basics: {
      fullName: "Jane Doe",
      title: "Software Engineer",
      email: "jane@example.com",
      phone: "+61 400 000 000",
      location: "Sydney",
    },
    links: [
      { label: "LinkedIn", url: "https://linkedin.com/in/jane" },
      { label: "GitHub", url: "https://github.com/jane" },
    ],
    skills: [{ category: "Languages", items: ["TypeScript"] }],
    experiences: [
      {
        dates: "2022-present",
        title: "Software Engineer",
        company: "Example",
        bullets: ["Built systems"],
      },
    ],
    projects: [],
    education: [],
    ...overrides,
  };
}

function finalApplication(input: {
  id: string;
  profile: ReturnType<typeof storedProfile>;
  job: { title: string; company: string | null; market: string };
}) {
  const content = aiContent();
  const context = buildApplicationPublicationRenderContext({
    profile: input.profile,
    job: input.job,
  });
  const resumeHash = hashApplicationDocumentContent(
    content,
    "resume",
    context,
  );
  const coverHash = hashApplicationDocumentContent(content, "cover", context);
  return {
    id: input.id,
    status: "FINAL" as const,
    aiContent: content,
    aiContentHash: "aggregate-hash",
    resumePdfUrl: `https://blob.example/${input.id}/resume.pdf`,
    coverPdfUrl: `https://blob.example/${input.id}/cover.pdf`,
    resumeContentHash: resumeHash,
    resumePublishedHash: resumeHash,
    coverContentHash: coverHash,
    coverPublishedHash: coverHash,
    job: input.job,
  };
}

function persistedPublicationPatches() {
  expect(executeRawStore).toHaveBeenCalledOnce();
  const serializedPatches = executeRawStore.mock.calls[0]?.[1];
  expect(typeof serializedPatches).toBe("string");
  return JSON.parse(serializedPatches as string) as Array<
    {
      id: string;
    } & Record<string, string | null>
  >;
}

describe("resumeProfile data access", () => {
  beforeEach(() => {
    resumeProfileStore.findFirst.mockReset();
    resumeProfileStore.findMany.mockReset();
    resumeProfileStore.update.mockReset();
    resumeProfileStore.create.mockReset();
    resumeProfileStore.delete.mockReset();
    activeResumeProfileStore.findUnique.mockReset();
    activeResumeProfileStore.upsert.mockReset();
    applicationStore.findMany.mockReset().mockResolvedValue([]);
    applicationStore.updateMany.mockReset();
    executeRawStore.mockReset();
    executeRawStore.mockImplementation(
      (_query: TemplateStringsArray, serializedPatches: string) =>
        (JSON.parse(serializedPatches) as unknown[]).length,
    );
    queryRawStore.mockReset();
    queryRawStore.mockImplementation(
      (_query: TemplateStringsArray, profileId: string) => [{ id: profileId }],
    );
    transactionStore.run.mockReset();
    transactionStore.run.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return arg({
          resumeProfile: resumeProfileStore,
          activeResumeProfile: activeResumeProfileStore,
          application: applicationStore,
          $executeRaw: executeRawStore,
          $queryRaw: queryRawStore,
        });
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it("returns active profile when pointer exists", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-1" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-1",
      userId: "user-1",
      name: "Custom Blank",
    });

    const profile = await getResumeProfile("user-1");

    expect(activeResumeProfileStore.findUnique).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "en-AU" } },
      select: { resumeProfileId: true },
    });
    expect(profile?.id).toBe("rp-1");
  });

  it("falls back to latest profile and backfills active pointer", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce(null);
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-2",
      userId: "user-1",
      name: "Custom Blank",
    });

    const profile = await getResumeProfile("user-1");

    expect(profile?.id).toBe("rp-2");
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "en-AU" } },
      update: { resumeProfileId: "rp-2" },
      create: { userId: "user-1", locale: "en-AU", resumeProfileId: "rp-2" },
    });
  });

  it("upserts selected profile and bumps revision", async () => {
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-5",
      userId: "user-1",
      name: "Custom Blank 2",
    });
    resumeProfileStore.update.mockResolvedValueOnce({
      id: "rp-5",
      userId: "user-1",
      name: "Graduate CV",
      summary: "Updated",
    });

    const profile = await upsertResumeProfile(
      "user-1",
      {
        summary: "Updated",
      },
      {
        profileId: "rp-5",
        name: "Graduate CV",
        setActive: true,
      },
    );

    expect(resumeProfileStore.update).toHaveBeenCalledWith({
      where: { id: "rp-5" },
      data: {
        summary: "Updated",
        basics: undefined,
        links: undefined,
        skills: undefined,
        experiences: undefined,
        projects: undefined,
        education: undefined,
        name: "Graduate CV",
        revision: { increment: 1 },
      },
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalled();
    expect(applicationStore.findMany).toHaveBeenCalled();
    expect(applicationStore.updateMany).not.toHaveBeenCalled();
    expect(executeRawStore).not.toHaveBeenCalled();
    expect(profile?.name).toBe("Graduate CV");
  });

  it("invalidates only Resume for Resume-only profile changes across distinct jobs", async () => {
    const previousProfile = storedProfile();
    const updatedProfile = storedProfile({
      revision: 2,
      skills: [{ category: "Languages", items: ["TypeScript", "Go"] }],
    });
    const auJob = {
      title: "Platform Engineer",
      company: "Acme AU",
      market: "AU",
    };
    const cnJob = {
      title: "Staff Engineer",
      company: "Acme CN",
      market: "CN",
    };
    const auApplication = finalApplication({
      id: "app-au",
      profile: previousProfile,
      job: auJob,
    });
    const cnApplication = finalApplication({
      id: "app-cn",
      profile: previousProfile,
      job: cnJob,
    });
    resumeProfileStore.findFirst.mockResolvedValueOnce(previousProfile);
    resumeProfileStore.update.mockResolvedValueOnce(updatedProfile);
    applicationStore.findMany.mockResolvedValueOnce([
      auApplication,
      cnApplication,
    ]);

    await upsertResumeProfile(
      "user-1",
      {
        skills: [{ category: "Languages", items: ["TypeScript", "Go"] }],
      },
      { profileId: "rp-linked", setActive: false },
    );

    expect(transactionStore.run).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 5_000, timeout: 30_000 },
    );
    const patches = persistedPublicationPatches();
    expect(patches).toHaveLength(2);

    for (const application of [auApplication, cnApplication]) {
      const nextContext = buildApplicationPublicationRenderContext({
        profile: updatedProfile,
        job: application.job,
      });
      const nextResumeHash = hashApplicationDocumentContent(
        application.aiContent,
        "resume",
        nextContext,
      );
      expect(nextResumeHash).not.toBe(application.resumeContentHash);
      expect(
        hashApplicationDocumentContent(
          application.aiContent,
          "cover",
          nextContext,
        ),
      ).toBe(application.coverContentHash);
      expect(patches).toContainEqual({
        id: application.id,
        status: "DRAFT",
        resumeContentHash: nextResumeHash,
        resumePublishedHash: application.resumePublishedHash,
        coverContentHash: application.coverContentHash,
        coverPublishedHash: application.coverPublishedHash,
      });
    }
    for (const patch of patches) {
      expect(patch).not.toHaveProperty("resumePdfUrl");
      expect(patch).not.toHaveProperty("coverPdfUrl");
    }
  });

  it("passes ownership scope beside the parameterized publication patch set", async () => {
    const previousProfile = storedProfile();
    const updatedProfile = storedProfile({
      revision: 2,
      skills: [{ category: "Languages", items: ["TypeScript", "Go"] }],
    });
    const application = finalApplication({
      id: "app-owned",
      profile: previousProfile,
      job: {
        title: "Platform Engineer",
        company: "Acme",
        market: "AU",
      },
    });
    resumeProfileStore.findFirst.mockResolvedValueOnce(previousProfile);
    resumeProfileStore.update.mockResolvedValueOnce(updatedProfile);
    applicationStore.findMany.mockResolvedValueOnce([application]);

    await upsertResumeProfile(
      "user-1",
      {
        skills: [{ category: "Languages", items: ["TypeScript", "Go"] }],
      },
      { profileId: "rp-linked", setActive: false },
    );

    expect(executeRawStore.mock.calls[0]?.slice(2)).toEqual([
      "user-1",
      "rp-linked",
    ]);
  });

  it("invalidates Cover as well when candidate header render input changes", async () => {
    const previousProfile = storedProfile();
    const updatedProfile = storedProfile({
      revision: 2,
      basics: {
        ...(previousProfile.basics as Record<string, unknown>),
        fullName: "Jane Q. Doe",
      },
    });
    const job = {
      title: "Platform Engineer",
      company: "Acme",
      market: "AU",
    };
    const application = finalApplication({
      id: "app-header",
      profile: previousProfile,
      job,
    });
    resumeProfileStore.findFirst.mockResolvedValueOnce(previousProfile);
    resumeProfileStore.update.mockResolvedValueOnce(updatedProfile);
    applicationStore.findMany.mockResolvedValueOnce([application]);

    await upsertResumeProfile(
      "user-1",
      { basics: updatedProfile.basics },
      { profileId: "rp-linked", setActive: false },
    );

    const nextContext = buildApplicationPublicationRenderContext({
      profile: updatedProfile,
      job,
    });
    const nextResumeHash = hashApplicationDocumentContent(
      application.aiContent,
      "resume",
      nextContext,
    );
    const nextCoverHash = hashApplicationDocumentContent(
      application.aiContent,
      "cover",
      nextContext,
    );
    expect(nextResumeHash).not.toBe(application.resumeContentHash);
    expect(nextCoverHash).not.toBe(application.coverContentHash);
    expect(persistedPublicationPatches()).toEqual([
      {
        id: "app-header",
        status: "DRAFT",
        resumeContentHash: nextResumeHash,
        resumePublishedHash: application.resumePublishedHash,
        coverContentHash: nextCoverHash,
        coverPublishedHash: application.coverPublishedHash,
      },
    ]);
  });

  it("does not rewrite publication state for a non-rendered Profile field", async () => {
    const previousProfile = storedProfile();
    const updatedProfile = storedProfile({
      revision: 2,
      basics: {
        ...(previousProfile.basics as Record<string, unknown>),
        location: "Melbourne",
      },
    });
    const job = {
      title: "Platform Engineer",
      company: "Acme",
      market: "AU",
    };
    const application = finalApplication({
      id: "app-location",
      profile: previousProfile,
      job,
    });
    resumeProfileStore.findFirst.mockResolvedValueOnce(previousProfile);
    resumeProfileStore.update.mockResolvedValueOnce(updatedProfile);
    applicationStore.findMany.mockResolvedValueOnce([application]);

    await upsertResumeProfile(
      "user-1",
      { basics: updatedProfile.basics },
      { profileId: "rp-linked", setActive: false },
    );

    expect(executeRawStore).not.toHaveBeenCalled();
  });

  it("falls back to conservative invalidation when Job render context is unavailable", async () => {
    const previousProfile = storedProfile();
    const updatedProfile = storedProfile({
      revision: 2,
      skills: [{ category: "Languages", items: ["TypeScript", "Go"] }],
    });
    const application = {
      ...finalApplication({
        id: "app-orphan",
        profile: previousProfile,
        job: {
          title: "Platform Engineer",
          company: "Acme",
          market: "AU",
        },
      }),
      job: null,
    };
    resumeProfileStore.findFirst.mockResolvedValueOnce(previousProfile);
    resumeProfileStore.update.mockResolvedValueOnce(updatedProfile);
    applicationStore.findMany.mockResolvedValueOnce([application]);

    await upsertResumeProfile(
      "user-1",
      {
        skills: [{ category: "Languages", items: ["TypeScript", "Go"] }],
      },
      { profileId: "rp-linked", setActive: false },
    );

    expect(persistedPublicationPatches()).toEqual([
      {
        id: "app-orphan",
        status: "DRAFT",
        resumeContentHash: null,
        resumePublishedHash: null,
        coverContentHash: null,
        coverPublishedHash: null,
      },
    ]);
    const persistence = persistedPublicationPatches()[0];
    expect(persistence).not.toHaveProperty("resumePdfUrl");
    expect(persistence).not.toHaveProperty("coverPdfUrl");
  });

  it("returns null when explicit profileId does not belong to user", async () => {
    resumeProfileStore.findFirst.mockResolvedValueOnce(null);

    const result = await upsertResumeProfile(
      "user-1",
      { summary: "Updated" },
      { profileId: "rp-missing" },
    );

    expect(result).toBeNull();
    expect(resumeProfileStore.create).not.toHaveBeenCalled();
  });

  it("refuses to write a profile from another locale", async () => {
    // Switching the editor's locale used to fire an autosave carrying the
    // PREVIOUS locale's profileId with the NEW locale. The lookup ignored
    // locale, so the CN profile was updated and then pinned as the active
    // profile for en-AU — every later EN load returned the Chinese resume.
    // The DB returns nothing for an id that does not live in the target
    // locale, which is what this mock stands in for.
    resumeProfileStore.findFirst.mockResolvedValueOnce(null);

    const result = await upsertResumeProfile(
      "user-1",
      { summary: "Chinese content" },
      { profileId: "rp-cn", locale: "en-AU" },
    );

    // The lookup itself must carry the locale — that is the actual guard, and
    // a mock cannot enforce a WHERE clause on our behalf.
    expect(resumeProfileStore.findFirst).toHaveBeenCalledWith({
      where: { id: "rp-cn", userId: "user-1", locale: "en-AU" },
    });
    expect(result).toBeNull();
    expect(resumeProfileStore.update).not.toHaveBeenCalled();
    expect(resumeProfileStore.create).not.toHaveBeenCalled();
    // The critical assertion: the active pointer for the target locale must
    // never be repointed at a profile belonging to a different one.
    expect(activeResumeProfileStore.upsert).not.toHaveBeenCalled();
  });

  it("scopes activation to the requested locale", async () => {
    resumeProfileStore.findFirst.mockResolvedValueOnce(null);

    const result = await setActiveResumeProfile("user-1", "en-AU", "rp-cn");

    expect(resumeProfileStore.findFirst).toHaveBeenCalledWith({
      where: { id: "rp-cn", userId: "user-1", locale: "en-AU" },
    });
    expect(result).toBeNull();
    expect(activeResumeProfileStore.upsert).not.toHaveBeenCalled();
  });

  it("creates a new profile and marks it active", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-active" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      summary: "Existing summary",
      basics: { fullName: "Jane Doe" },
      links: [{ label: "LinkedIn", url: "https://example.com" }],
      skills: [{ category: "Languages", items: ["TypeScript"] }],
      experiences: [{ title: "SE", company: "A", location: "Sydney", dates: "2020-2021", bullets: ["Built"] }],
      projects: [],
      education: [],
    });
    resumeProfileStore.findMany.mockResolvedValueOnce([{ name: "Custom Blank" }]);
    resumeProfileStore.create.mockResolvedValueOnce({
      id: "rp-new",
      userId: "user-1",
      name: "Custom Blank 2",
      summary: "Existing summary",
    });

    const profile = await createResumeProfile("user-1");

    expect(profile.id).toBe("rp-new");
    expect(resumeProfileStore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        name: "Custom Blank 2",
        locale: "en-AU",
        summary: "Existing summary",
      }),
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalled();
  });

  it("creates a blank profile when mode is blank", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([{ name: "Custom Blank" }]);
    resumeProfileStore.create.mockResolvedValueOnce({
      id: "rp-empty",
      userId: "user-1",
      name: "Custom Blank 2",
    });

    const profile = await createResumeProfile("user-1", { mode: "blank" });

    expect(profile.id).toBe("rp-empty");
    expect(resumeProfileStore.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        name: "Custom Blank 2",
        locale: "en-AU",
      },
    });
  });

  it("lists profiles and flags active profile", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([
      {
        id: "rp-1",
        name: "Custom Blank",
        createdAt: new Date("2026-02-21T01:00:00.000Z"),
        updatedAt: new Date("2026-02-21T02:00:00.000Z"),
        revision: 1,
      },
      {
        id: "rp-2",
        name: "Custom Blank 2",
        createdAt: new Date("2026-02-21T00:00:00.000Z"),
        updatedAt: new Date("2026-02-21T01:00:00.000Z"),
        revision: 1,
      },
    ]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-2" });

    const result = await listResumeProfiles("user-1");

    expect(result.activeProfileId).toBe("rp-2");
    expect(result.profiles[1]?.isActive).toBe(true);
  });

  it("sets active profile only when profile belongs to user", async () => {
    resumeProfileStore.findFirst.mockResolvedValueOnce({ id: "rp-9", userId: "user-1" });

    const target = await setActiveResumeProfile("user-1", "en-AU", "rp-9");

    expect(target?.id).toBe("rp-9");
    expect(activeResumeProfileStore.upsert).toHaveBeenCalled();
  });

  it("deletes selected profile and rotates active pointer", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([{ id: "rp-1" }, { id: "rp-2" }]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-1" });
    resumeProfileStore.delete.mockResolvedValueOnce({ id: "rp-1" });

    const result = await deleteResumeProfile("user-1", "en-AU", "rp-1");

    expect(result).toEqual({
      status: "deleted",
      deletedProfileId: "rp-1",
      activeProfileId: "rp-2",
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "en-AU" } },
      update: { resumeProfileId: "rp-2" },
      create: { userId: "user-1", locale: "en-AU", resumeProfileId: "rp-2" },
    });
    expect(applicationStore.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        resumeProfileId: "rp-1",
      },
      data: {
        status: "DRAFT",
        resumeContentHash: null,
        resumePublishedHash: null,
        coverContentHash: null,
        coverPublishedHash: null,
      },
    });
  });

  it("locks the owned Profile row before invalidating Applications and deleting", async () => {
    const order: string[] = [];
    queryRawStore.mockImplementationOnce(
      (
        query: TemplateStringsArray,
        profileId: string,
        userId: string,
        locale: string,
      ) => {
        order.push("profile-lock");
        expect(query.join(" ")).toContain("FOR UPDATE OF profile");
        expect([profileId, userId, locale]).toEqual([
          "rp-1",
          "user-1",
          "en-AU",
        ]);
        return [{ id: "rp-1" }];
      },
    );
    resumeProfileStore.findMany.mockResolvedValueOnce([
      { id: "rp-1" },
      { id: "rp-2" },
    ]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({
      resumeProfileId: "rp-1",
    });
    applicationStore.updateMany.mockImplementationOnce(async () => {
      order.push("application-invalidation");
      return { count: 1 };
    });
    resumeProfileStore.delete.mockImplementationOnce(async () => {
      order.push("profile-delete");
      return { id: "rp-1" };
    });

    const result = await deleteResumeProfile("user-1", "en-AU", "rp-1");

    expect(result.status).toBe("deleted");
    expect(order).toEqual([
      "profile-lock",
      "application-invalidation",
      "profile-delete",
    ]);
  });

  it("treats a missing or unowned Profile as not found before any mutation", async () => {
    queryRawStore.mockResolvedValueOnce([]);

    const result = await deleteResumeProfile(
      "user-1",
      "en-AU",
      "profile-owned-by-someone-else",
    );

    expect(result).toEqual({ status: "not_found" });
    expect(resumeProfileStore.findMany).not.toHaveBeenCalled();
    expect(applicationStore.updateMany).not.toHaveBeenCalled();
    expect(resumeProfileStore.delete).not.toHaveBeenCalled();
  });

  it("blocks deleting the last remaining profile", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([{ id: "rp-only" }]);

    const result = await deleteResumeProfile("user-1", "en-AU", "rp-only");

    expect(result).toEqual({ status: "last_profile" });
    expect(resumeProfileStore.delete).not.toHaveBeenCalled();
  });

  it("getResumeProfile scopes active pointer lookup by locale", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-zh" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-zh",
      userId: "user-1",
      name: "中文简历",
      locale: "zh-CN",
    });

    const profile = await getResumeProfile("user-1", { locale: "zh-CN" });

    expect(activeResumeProfileStore.findUnique).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      select: { resumeProfileId: true },
    });
    expect(profile?.id).toBe("rp-zh");
  });

  it("fallback scopes by locale and backfills with locale", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce(null);
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-zh-latest",
      userId: "user-1",
      locale: "zh-CN",
    });

    const profile = await getResumeProfile("user-1", { locale: "zh-CN" });

    expect(resumeProfileStore.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", locale: "zh-CN" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      update: { resumeProfileId: "rp-zh-latest" },
      create: { userId: "user-1", locale: "zh-CN", resumeProfileId: "rp-zh-latest" },
    });
    expect(profile?.id).toBe("rp-zh-latest");
  });

  it("lists only profiles for the requested locale", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([
      {
        id: "rp-zh-1",
        name: "中文简历",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        updatedAt: new Date("2026-03-01T00:00:00.000Z"),
        revision: 1,
      },
    ]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-zh-1" });

    const result = await listResumeProfiles("user-1", "zh-CN");

    expect(resumeProfileStore.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", locale: "zh-CN" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        revision: true,
      },
    });
    expect(activeResumeProfileStore.findUnique).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      select: { resumeProfileId: true },
    });
    expect(result.activeProfileId).toBe("rp-zh-1");
  });

  it("creates a profile with zh-CN locale", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([]);
    resumeProfileStore.create.mockResolvedValueOnce({
      id: "rp-zh-new",
      userId: "user-1",
      name: "Custom Blank",
      locale: "zh-CN",
    });

    const profile = await createResumeProfile("user-1", { locale: "zh-CN", mode: "blank" });

    expect(profile.id).toBe("rp-zh-new");
    expect(resumeProfileStore.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        name: "Custom Blank",
        locale: "zh-CN",
      },
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      update: { resumeProfileId: "rp-zh-new" },
      create: { userId: "user-1", locale: "zh-CN", resumeProfileId: "rp-zh-new" },
    });
  });

  it("deletes profile and rotates active pointer with locale", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([{ id: "rp-zh-1" }, { id: "rp-zh-2" }]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-zh-1" });
    resumeProfileStore.delete.mockResolvedValueOnce({ id: "rp-zh-1" });

    const result = await deleteResumeProfile("user-1", "zh-CN", "rp-zh-1");

    expect(resumeProfileStore.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", locale: "zh-CN" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    expect(result).toEqual({
      status: "deleted",
      deletedProfileId: "rp-zh-1",
      activeProfileId: "rp-zh-2",
    });
  });
});
