import { describe, expect, it, vi } from "vitest";
import {
  parseAtsBoardRegistry,
  parseAtsBoardRegistryJson,
  type AtsBoardConfig,
} from "@/lib/server/sources/atsBoards";
import {
  createAtsAdapter,
  getAtsBoardRequest,
} from "@/lib/server/sources/adapters/ats";
import type { SourceContext } from "@/lib/server/sources/types";

function board(
  provider: AtsBoardConfig["provider"],
  overrides: Partial<AtsBoardConfig> = {},
): AtsBoardConfig {
  return {
    id: `ats:${provider}:acme`,
    provider,
    boardToken: "acme",
    company: "Acme",
    ...overrides,
  };
}

function context(payload: unknown) {
  const fetchJson = vi.fn(async () => payload);
  return { ctx: { fetchJson } satisfies SourceContext, fetchJson };
}

describe("ATS board registry", () => {
  it("normalizes valid deployment-owned entries", () => {
    const result = parseAtsBoardRegistry([
      {
        provider: "lever",
        boardToken: "Acme-AU",
        company: "Acme Australia",
        region: "eu",
        careersUrl: "https://careers.acme.example/jobs",
      },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.boards).toEqual([
      {
        id: "ats:lever:acme-au",
        provider: "lever",
        boardToken: "Acme-AU",
        company: "Acme Australia",
        region: "eu",
        careersUrl: "https://careers.acme.example/jobs",
      },
    ]);
  });

  it("rejects unsafe tenants, credentials, duplicates, and bad JSON", () => {
    expect(
      parseAtsBoardRegistry([
        { provider: "greenhouse", boardToken: "../admin", company: "Acme" },
        {
          id: "ats:lever:acme",
          provider: "lever",
          boardToken: "acme",
          company: "Acme",
        },
        {
          id: "ats:lever:acme",
          provider: "lever",
          boardToken: "acme-two",
          company: "Acme",
        },
        {
          provider: "ashby",
          boardToken: "acme",
          company: "Acme",
          careersUrl: "https://user:secret@example.com/jobs",
        },
      ]).issues.map((issue) => issue.code),
    ).toEqual([
      "invalid_board_token",
      "duplicate_id",
      "invalid_careers_url",
    ]);
    expect(
      parseAtsBoardRegistry([
        {
          id: "remoteok",
          provider: "greenhouse",
          boardToken: "acme",
          company: "Acme",
        },
      ]).issues[0].code,
    ).toBe("invalid_id");
    expect(parseAtsBoardRegistryJson("{").issues[0].code).toBe("invalid_json");
  });

  it("bounds generated source ids without truncation collisions", () => {
    const prefix = "a".repeat(90);
    const first = parseAtsBoardRegistry([
      { provider: "greenhouse", boardToken: `${prefix}x`, company: "Acme" },
    ]).boards[0].id;
    const second = parseAtsBoardRegistry([
      { provider: "greenhouse", boardToken: `${prefix}y`, company: "Acme" },
    ]).boards[0].id;
    expect(first).toHaveLength(60);
    expect(second).toHaveLength(60);
    expect(first).not.toBe(second);
  });

  it("keeps the bounded valid prefix when excess boards are configured", () => {
    const result = parseAtsBoardRegistry(
      Array.from({ length: 251 }, (_, index) => ({
        provider: "greenhouse",
        boardToken: `company-${index}`,
        company: `Company ${index}`,
      })),
    );

    expect(result.boards).toHaveLength(250);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "too_many_boards" }),
    ]);
  });
});

describe("config-driven ATS adapters", () => {
  it("normalizes Greenhouse public board jobs", async () => {
    const config = board("greenhouse");
    const { ctx, fetchJson } = context({
      jobs: [
        {
          title: "Backend Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/123",
          location: { name: "Sydney, Australia" },
          content: "<p>Build reliable APIs.</p>",
          updated_at: "2026-07-20T01:00:00Z",
        },
      ],
    });

    const jobs = await createAtsAdapter(config).fetch(ctx);

    expect(fetchJson).toHaveBeenCalledWith(
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
      ["boards-api.greenhouse.io"],
    );
    expect(jobs[0]).toMatchObject({
      title: "Backend Engineer",
      company: "Acme",
      location: "Sydney, Australia",
      description: "Build reliable APIs.",
      source: config.id,
    });
  });

  it("uses Lever's EU host and maps public posting fields", async () => {
    const config = board("lever", { region: "eu" });
    const { ctx } = context([
      {
        text: "Platform Engineer",
        hostedUrl: "https://jobs.eu.lever.co/acme/posting-1",
        categories: {
          location: "Berlin",
          commitment: "Full-time",
          level: "Senior",
        },
        descriptionPlain: "Own the platform.",
        workplaceType: "hybrid",
        salaryRange: { min: 100000, max: 130000, currency: "EUR" },
        createdAt: 1_721_433_600_000,
      },
    ]);

    const jobs = await createAtsAdapter(config).fetch(ctx);

    expect(getAtsBoardRequest(config)).toEqual({
      url: "https://api.eu.lever.co/v0/postings/acme?mode=json",
      allowedHosts: ["api.eu.lever.co"],
    });
    expect(jobs[0]).toMatchObject({
      jobType: "Full-time",
      jobLevel: "Senior",
      salary: "100000 - 130000 EUR",
      workArrangement: "hybrid",
    });
  });

  it("normalizes Ashby and ignores unpublished rows", async () => {
    const config = board("ashby");
    const { ctx } = context({
      jobs: [
        {
          title: "AI Engineer",
          location: "Sydney",
          isListed: true,
          isRemote: true,
          employmentType: "FullTime",
          descriptionPlain: "Ship ML systems.",
          publishedAt: "2026-07-20T01:00:00Z",
          jobUrl: "https://jobs.ashbyhq.com/acme/role-1",
          compensation: { compensationTierSummary: "AUD 170k-190k" },
        },
        {
          title: "Hidden Role",
          isListed: false,
          jobUrl: "https://jobs.ashbyhq.com/acme/hidden",
        },
      ],
    });

    const jobs = await createAtsAdapter(config).fetch(ctx);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: "AI Engineer",
      workArrangement: "Remote",
      salary: "AUD 170k-190k",
    });
  });

  it("normalizes only published Workable jobs", async () => {
    const config = board("workable");
    const { ctx } = context({
      jobs: [
        {
          title: "Data Engineer",
          state: "published",
          url: "https://apply.workable.com/acme/j/ABC123",
          location: {
            location_str: "Melbourne, Australia",
            telecommuting: true,
          },
          salary: {
            salary_from: 140000,
            salary_to: 160000,
            salary_currency: "AUD",
          },
          created_at: "2026-07-20T01:00:00Z",
        },
        {
          title: "Closed role",
          state: "closed",
          url: "https://apply.workable.com/acme/j/CLOSED",
        },
      ],
    });

    const jobs = await createAtsAdapter(config).fetch(ctx);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: "Data Engineer",
      location: "Melbourne, Australia",
      salary: "140000 - 160000 AUD",
      workArrangement: "Remote",
    });
  });

  it("does not silently truncate a valid large tenant response", async () => {
    const config = board("lever");
    const { ctx } = context(
      Array.from({ length: 2_005 }, (_, index) => ({
        text: `Engineer ${index}`,
        hostedUrl: `https://jobs.lever.co/acme/${index}`,
      })),
    );

    const jobs = await createAtsAdapter(config).fetch(ctx);

    expect(jobs).toHaveLength(2_005);
    expect(jobs.at(-1)?.title).toBe("Engineer 2004");
  });

  it("fails closed when a non-empty ATS payload has no recognizable rows", async () => {
    const config = board("greenhouse");
    const { ctx } = context({ jobs: [{ renamed_title: "Engineer" }] });

    await expect(createAtsAdapter(config).fetch(ctx)).rejects.toThrow(
      "invalid payload; no recognizable job rows",
    );
  });
});
