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

const transactionStore = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    resumeProfile: resumeProfileStore,
    activeResumeProfile: activeResumeProfileStore,
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

describe("resumeProfile data access", () => {
  beforeEach(() => {
    resumeProfileStore.findFirst.mockReset();
    resumeProfileStore.findMany.mockReset();
    resumeProfileStore.update.mockReset();
    resumeProfileStore.create.mockReset();
    resumeProfileStore.delete.mockReset();
    activeResumeProfileStore.findUnique.mockReset();
    activeResumeProfileStore.upsert.mockReset();
    transactionStore.run.mockReset();
    transactionStore.run.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return arg({
          resumeProfile: resumeProfileStore,
          activeResumeProfile: activeResumeProfileStore,
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
    expect(profile.name).toBe("Graduate CV");
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
