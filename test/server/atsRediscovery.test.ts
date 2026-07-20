import { describe, expect, it, vi } from "vitest";
import {
  discoverAtsBoardsFromHtml,
  parseAtsBoardUrl,
  rediscoverAtsBoardAfter404,
} from "@/lib/server/sources/atsRediscovery";
import type { AtsBoardConfig } from "@/lib/server/sources/atsBoards";

const CURRENT: AtsBoardConfig = {
  id: "ats:greenhouse:acme",
  provider: "greenhouse",
  boardToken: "acme-old",
  company: "Acme",
  careersUrl: "https://careers.acme.example",
};

describe("ATS board rediscovery", () => {
  it("parses hosted and API board URLs without accepting arbitrary hosts", () => {
    expect(
      parseAtsBoardUrl("https://boards.greenhouse.io/acme/jobs/123"),
    ).toMatchObject({ provider: "greenhouse", boardToken: "acme" });
    expect(
      parseAtsBoardUrl("https://api.eu.lever.co/v0/postings/acme?mode=json"),
    ).toMatchObject({ provider: "lever", boardToken: "acme", region: "eu" });
    expect(
      parseAtsBoardUrl(
        "https://api.ashbyhq.com/posting-api/job-board/acme",
      ),
    ).toMatchObject({ provider: "ashby", boardToken: "acme" });
    expect(
      parseAtsBoardUrl("https://www.workable.com/api/accounts/acme"),
    ).toMatchObject({ provider: "workable", boardToken: "acme" });
    expect(parseAtsBoardUrl("https://evil.example/acme")).toBeNull();
    expect(
      parseAtsBoardUrl("https://apply.workable.com/j/INDIVIDUAL"),
    ).toBeNull();
  });

  it("extracts unique ATS tenants from company careers HTML", () => {
    const candidates = discoverAtsBoardsFromHtml(
      `
        <a href="https://boards.greenhouse.io/acme-new/jobs">Jobs</a>
        <a href="https://boards.greenhouse.io/acme-new/jobs/123">Duplicate</a>
        <a href="https://jobs.lever.co/acme">Other ATS</a>
        <a href="https://attacker.example/jobs">Ignore</a>
      `,
      "https://careers.acme.example",
    );

    expect(candidates.map((item) => `${item.provider}:${item.boardToken}`)).toEqual([
      "greenhouse:acme-new",
      "lever:acme",
    ]);
  });

  it("replaces only the board token after confirmed 404 and successful probe", async () => {
    const probe = vi
      .fn<(candidate: AtsBoardConfig) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const candidates = [
      parseAtsBoardUrl("https://jobs.lever.co/wrong-provider")!,
      parseAtsBoardUrl("https://boards.greenhouse.io/stale/jobs")!,
      parseAtsBoardUrl("https://boards.greenhouse.io/acme-new/jobs")!,
    ];

    const result = await rediscoverAtsBoardAfter404({
      failedStatus: 404,
      current: CURRENT,
      candidates,
      probe,
    });

    expect(result.status).toBe("rediscovered");
    expect(result.config).toEqual({ ...CURRENT, boardToken: "acme-new" });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("does nothing for non-404 failures", async () => {
    const probe = vi.fn(async () => true);
    const result = await rediscoverAtsBoardAfter404({
      failedStatus: 503,
      current: CURRENT,
      candidates: [
        parseAtsBoardUrl("https://boards.greenhouse.io/acme-new/jobs")!,
      ],
      probe,
    });

    expect(result.status).toBe("not_applicable");
    expect(probe).not.toHaveBeenCalled();
  });
});
