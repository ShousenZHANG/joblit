import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  listPromptRuleTemplates: vi.fn(),
  createPromptRuleTemplate: vi.fn(),
  activatePromptRuleTemplate: vi.fn(),
  resetPromptRulesToDefault: vi.fn(),
}));

vi.mock("@/lib/server/promptRuleTemplates", () => service);

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { GET as GET_RULES, POST as CREATE_RULE } from "@/app/api/prompt-rules/route";
import { POST as ACTIVATE_RULE } from "@/app/api/prompt-rules/[id]/activate/route";
import { POST as RESET_DEFAULT } from "@/app/api/prompt-rules/reset-default/route";

describe("prompt rules api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    service.listPromptRuleTemplates.mockReset();
    service.createPromptRuleTemplate.mockReset();
    service.activatePromptRuleTemplate.mockReset();
    service.resetPromptRulesToDefault.mockReset();
  });

  it("lists templates", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    service.listPromptRuleTemplates.mockResolvedValueOnce([
      {
        id: "tpl-1",
        name: "Default",
        version: 1,
        locale: "en-AU",
        isActive: true,
        cvRules: ["a"],
        coverRules: ["b"],
        hardConstraints: ["c"],
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const res = await GET_RULES();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.templates).toHaveLength(1);
    expect(json.templates[0].isActive).toBe(true);
  });

  it("creates template", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    service.createPromptRuleTemplate.mockResolvedValueOnce({
      id: "tpl-2",
      name: "Custom",
      version: 2,
      locale: "en-AU",
      isActive: false,
    });

    const res = await CREATE_RULE(
      new Request("http://localhost/api/prompt-rules", {
        method: "POST",
        body: JSON.stringify({
          name: "Custom",
          cvRules: ["cv"],
          coverRules: ["cover"],
          hardConstraints: ["hard"],
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.template.version).toBe(2);
  });

  it("activates template", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    const tplId = "33333333-3333-4333-8333-333333333333";
    service.activatePromptRuleTemplate.mockResolvedValueOnce({
      id: tplId,
      name: "v3",
      version: 3,
      isActive: true,
    });

    const res = await ACTIVATE_RULE(
      new Request(`http://localhost/api/prompt-rules/${tplId}/activate`, { method: "POST" }),
      { params: Promise.resolve({ id: tplId }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.template.id).toBe(tplId);
  });

  it("rejects a non-UUID template id with 400", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await ACTIVATE_RULE(
      new Request("http://localhost/api/prompt-rules/not-a-uuid/activate", { method: "POST" }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(res.status).toBe(400);
    expect(service.activatePromptRuleTemplate).not.toHaveBeenCalled();
  });

  it("resets to default", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    service.resetPromptRulesToDefault.mockResolvedValueOnce({
      id: "tpl-4",
      name: "Default rules",
      version: 4,
      isActive: true,
    });

    const res = await RESET_DEFAULT();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.template.name).toBe("Default rules");
  });
});

