import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Vercel Discover cron contract", () => {
  it("keeps the production build gate and schedules only one daily Discover refresh", async () => {
    const config = JSON.parse(
      await readFile(`${process.cwd()}/vercel.json`, "utf8"),
    ) as {
      buildCommand?: string;
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(config.buildCommand).toBe("node tools/deploy/vercel-build.mjs");
    expect(config.crons).toEqual([
      {
        path: "/api/discover/refresh-daily",
        schedule: "0 6 * * *",
      },
    ]);
    expect(
      config.crons?.some(({ path }) => /fetch|job/i.test(path)),
    ).toBe(false);
  });
});
