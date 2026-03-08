import { beforeEach, describe, expect, it, vi } from "vitest";

const resumeProfileService = vi.hoisted(() => ({
  listResumeProfiles: vi.fn(),
  getResumeProfile: vi.fn(),
  upsertResumeProfile: vi.fn(),
  createResumeProfile: vi.fn(),
  setActiveResumeProfile: vi.fn(),
  renameResumeProfile: vi.fn(),
  deleteResumeProfile: vi.fn(),
}));

vi.mock("@/lib/server/resumeProfile", () => resumeProfileService);

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { GET, PATCH, POST } from "@/app/api/resume-profile/route";

describe("resume profile api", () => {
  beforeEach(() => {
    Object.values(resumeProfileService).forEach((fn) => fn.mockReset());
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("returns profile state for authorized user", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    resumeProfileService.listResumeProfiles.mockResolvedValue({
      profiles: [
        {
          id: "rp-1",
          name: "Custom Blank",
          isActive: true,
          revision: 2,
          createdAt: new Date("2026-02-21T01:00:00.000Z"),
          updatedAt: new Date("2026-02-21T02:00:00.000Z"),
        },
      ],
      activeProfileId: "rp-1",
    });
    resumeProfileService.getResumeProfile.mockResolvedValue({
      id: "rp-1",
      name: "Custom Blank",
      summary: "Hello",
    });

    const res = await GET(
      new Request("http://localhost/api/resume-profile"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.activeProfileId).toBe("rp-1");
    expect(json.profile.summary).toBe("Hello");
  });

  it("upserts selected profile on POST", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    resumeProfileService.upsertResumeProfile.mockResolvedValue({ id: "rp-1" });
    resumeProfileService.listResumeProfiles.mockResolvedValue({
      profiles: [{ id: "rp-1", name: "Custom Blank", isActive: true }],
      activeProfileId: "rp-1",
    });
    resumeProfileService.getResumeProfile.mockResolvedValue({ id: "rp-1", summary: "Hello" });

    const payload = {
      profileId: "f4edabe1-c5e2-4032-80c8-8f79043e57fd",
      name: "Graduate CV",
      setActive: true,
      summary: "Hello",
      basics: {
        fullName: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
        location: "Sydney",
      },
      links: [{ label: "LinkedIn", url: "https://linkedin.com/in/jane" }],
      experiences: [
        {
          location: "Sydney, Australia",
          dates: "2023-2025",
          title: "Software Engineer",
          company: "Example Co",
          bullets: ["Built features"],
        },
      ],
      projects: [
        {
          name: "Jobflow",
          location: "Sydney, Australia",
          dates: "2024",
          stack: "Next.js, TypeScript",
          links: [{ label: "GitHub", url: "https://example.com" }],
          bullets: ["Shipped"],
        },
      ],
      education: [
        {
          school: "UNSW",
          degree: "MIT",
          location: "Sydney",
          dates: "2020-2022",
          details: "WAM 80",
        },
      ],
      skills: [{ category: "Languages", items: ["TypeScript", "Python"] }],
    };

    const res = await POST(
      new Request("http://localhost/api/resume-profile", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );

    expect(res.status).toBe(200);
    expect(resumeProfileService.upsertResumeProfile).toHaveBeenCalledWith(
      "user-1",
      {
        summary: payload.summary,
        basics: payload.basics,
        links: payload.links,
        skills: payload.skills,
        experiences: payload.experiences,
        projects: payload.projects,
        education: payload.education,
      },
      {
        locale: "en-AU",
        profileId: payload.profileId,
        name: payload.name,
        setActive: payload.setActive,
      },
    );
  });

  it("returns 404 when saving with an unknown profileId", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    resumeProfileService.upsertResumeProfile.mockResolvedValue(null);

    const res = await POST(
      new Request("http://localhost/api/resume-profile", {
        method: "POST",
        body: JSON.stringify({
          profileId: "f4edabe1-c5e2-4032-80c8-8f79043e57fd",
          summary: "Hello",
        }),
      }),
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("PROFILE_NOT_FOUND");
  });

  it("activates selected profile on PATCH", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    resumeProfileService.setActiveResumeProfile.mockResolvedValue({ id: "rp-2" });
    resumeProfileService.listResumeProfiles.mockResolvedValue({
      profiles: [
        { id: "rp-1", name: "Custom Blank", isActive: false },
        { id: "rp-2", name: "Custom Blank 2", isActive: true },
      ],
      activeProfileId: "rp-2",
    });
    resumeProfileService.getResumeProfile.mockResolvedValue({ id: "rp-2", summary: "Updated" });

    const res = await PATCH(
      new Request("http://localhost/api/resume-profile", {
        method: "PATCH",
        body: JSON.stringify({
          action: "activate",
          profileId: "a6437908-54fd-4a26-a1e4-3350fc98ac63",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(resumeProfileService.setActiveResumeProfile).toHaveBeenCalled();
    const json = await res.json();
    expect(json.activeProfileId).toBe("rp-2");
  });

  it("creates new version from active profile on PATCH create", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    resumeProfileService.createResumeProfile.mockResolvedValue({ id: "rp-3" });
    resumeProfileService.listResumeProfiles.mockResolvedValue({
      profiles: [
        { id: "rp-2", name: "Experienced CV", isActive: false },
        { id: "rp-3", name: "Experienced CV 2", isActive: true },
      ],
      activeProfileId: "rp-3",
    });
    resumeProfileService.getResumeProfile.mockResolvedValue({ id: "rp-3", summary: "Copied" });

    const res = await PATCH(
      new Request("http://localhost/api/resume-profile", {
        method: "PATCH",
        body: JSON.stringify({
          action: "create",
          mode: "copy",
          sourceProfileId: "a6437908-54fd-4a26-a1e4-3350fc98ac63",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(resumeProfileService.createResumeProfile).toHaveBeenCalledWith("user-1", {
      locale: "en-AU",
      mode: "copy",
      sourceProfileId: "a6437908-54fd-4a26-a1e4-3350fc98ac63",
      name: undefined,
      setActive: true,
    });
  });

  it("returns 409 when deleting the last profile", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    resumeProfileService.deleteResumeProfile.mockResolvedValue({ status: "last_profile" });

    const res = await PATCH(
      new Request("http://localhost/api/resume-profile", {
        method: "PATCH",
        body: JSON.stringify({
          action: "delete",
          profileId: "a6437908-54fd-4a26-a1e4-3350fc98ac63",
        }),
      }),
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("LAST_PROFILE");
  });
});
