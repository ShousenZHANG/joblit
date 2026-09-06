import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalTailoringTask, Prisma } from "@/lib/generated/prisma";
const locked = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/server/applications/applicationSourceSnapshot", () => ({ lockOwnedApplicationSources: locked }));
import { assertTaskSources, readLockedTaskSources } from "./sources";

const profile = {
  id: "profile", userId: "owner", name: "Master", revision: 1, locale: "en-AU", summary: "Engineer",
  basics: { fullName: "Alex Chen", title: "Engineer", email: "alex@example.com", phone: "0400000000" },
  links: [], skills: [{ category: "Development", items: ["TypeScript"] }], certifications: [],
  experiences: [{ title: "Engineer", company: "Acme", dates: "2020–2026", bullets: ["Built TypeScript applications."] }],
  projects: [], education: [], updatedAt: new Date("2026-09-01"), createdAt: new Date("2026-01-01"),
};
const job = { id: "job", userId: "owner", title: "Engineer", company: "Acme", description: "Build TypeScript applications.", market: "AU" };
const template = { id: "rules", cvRules: ["Keep factual."], coverRules: ["Keep factual."], hardConstraints: ["Return JSON."], locale: "en-AU" };
const scope = { userId: "owner", jobId: "job", resumeProfileId: "profile", target: "resume" };
const store = { $queryRaw: vi.fn(), activeResumeProfile: { findUnique: vi.fn() }, resumeProfile: { findFirst: vi.fn() }, promptRuleTemplate: { findFirst: vi.fn() } };
const tx = store as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.clearAllMocks();
  locked.mockResolvedValue({ profile, job });
  store.activeResumeProfile.findUnique.mockResolvedValue({ resumeProfileId: "profile" });
  store.resumeProfile.findFirst.mockResolvedValue(profile);
  store.promptRuleTemplate.findFirst.mockResolvedValue(template);
});

describe("local task source fence", () => {
  async function issued() {
    const current = await readLockedTaskSources(tx, scope);
    return { ...scope, ...current.binding, locale: current.locale } as LocalTailoringTask;
  }
  it("rebuilds a stable production prompt from locked sources", async () => {
    const task = await issued();
    const current = await assertTaskSources(tx, task);
    expect(current.binding.promptHash).toBe(task.promptHash);
    expect(current.prompt.input).toContain("TypeScript");
    expect(current.prompt.instructions).toContain("untrusted-data-policy");
    expect(store.$queryRaw).toHaveBeenCalledTimes(4);
  });
  it.each(["profile", "job", "rules"] as const)("rejects changed %s even if a caller still holds a valid capability", async changed => {
    const task = await issued();
    if (changed === "profile") store.resumeProfile.findFirst.mockResolvedValue({ ...profile, summary: "Changed summary" });
    if (changed === "job") locked.mockResolvedValue({ profile, job: { ...job, description: "A different role" } });
    if (changed === "rules") store.promptRuleTemplate.findFirst.mockResolvedValue({ ...template, cvRules: ["Different current rule."] });
    await expect(assertTaskSources(tx, task)).rejects.toMatchObject({ code: "LOCAL_TASK_SOURCE_CHANGED" });
  });
  it("rejects a switched active profile and a deleted source", async () => {
    const task = await issued();
    store.activeResumeProfile.findUnique.mockResolvedValue({ resumeProfileId: "new-profile" });
    await expect(assertTaskSources(tx, task)).rejects.toMatchObject({ code: "LOCAL_TASK_SOURCE_CHANGED" });
    locked.mockResolvedValue(null);
    await expect(assertTaskSources(tx, task)).rejects.toMatchObject({ code: "LOCAL_TASK_SOURCE_CHANGED" });
  });
});
