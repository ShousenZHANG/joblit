import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    atsBoardSource: { findMany: store.findMany },
  },
}));

import { loadEnabledAtsBoardAdapters } from "@/lib/server/sources/atsBoardStore";

describe("ATS board store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads enabled config rows into pinned adapters", async () => {
    store.findMany.mockResolvedValue([
      {
        sourceId: "ats:greenhouse:acme",
        provider: "greenhouse",
        boardToken: "acme",
        company: "Acme",
        region: null,
        careersUrl: "https://careers.acme.example",
        enabled: true,
      },
    ]);

    const result = await loadEnabledAtsBoardAdapters();

    expect(store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
    expect(result.issues).toEqual([]);
    expect(result.boards).toEqual([
      {
        id: "ats:greenhouse:acme",
        provider: "greenhouse",
        boardToken: "acme",
        company: "Acme",
        careersUrl: "https://careers.acme.example/",
      },
    ]);
    expect(result.adapters).toHaveLength(1);
    expect(result.adapters[0]).toMatchObject({
      id: "ats:greenhouse:acme",
      allowedHosts: ["boards-api.greenhouse.io"],
    });
  });

  it("returns config issues without constructing unsafe adapters", async () => {
    store.findMany.mockResolvedValue([
      {
        sourceId: "ats:greenhouse:bad",
        provider: "greenhouse",
        boardToken: "../metadata",
        company: "Bad",
        region: null,
        careersUrl: null,
        enabled: true,
      },
    ]);

    const result = await loadEnabledAtsBoardAdapters();

    expect(result.adapters).toEqual([]);
    expect(result.boards).toEqual([]);
    expect(result.issues[0].code).toBe("invalid_board_token");
  });
});
