import { describe, expect, it } from "vitest";
import remoteok from "./remoteok";
import remotive from "./remotive";
import jobicy from "./jobicy";
import type { SourceContext } from "../types";

function ctxReturning(payload: unknown): SourceContext {
  return { fetchJson: async () => payload };
}

describe("remoteok adapter", () => {
  const SAMPLE = [
    { legal: "RemoteOK legal notice", last_updated: 1_700_000_000 },
    {
      position: "Senior AI Engineer",
      company: "Acme",
      location: "Worldwide",
      url: "https://remoteok.com/remote-jobs/123-senior-ai-engineer",
      description: "<p>Build agents &amp; ship them.</p>",
      date: "2026-07-18T09:00:00+00:00",
      salary_min: 150000,
      salary_max: 200000,
    },
    {
      position: "  Full Stack Developer  ",
      company: "  Globex  ",
      location: "",
      url: "  https://remoteok.com/remote-jobs/124-full-stack  ",
      date: "not-a-date",
    },
  ];

  it("skips the leading metadata object", async () => {
    const jobs = await remoteok.fetch(ctxReturning(SAMPLE));
    expect(jobs).toHaveLength(2);
  });

  it("normalizes a posting into RawSourceJob", async () => {
    const [job] = await remoteok.fetch(ctxReturning(SAMPLE));
    expect(job).toEqual({
      jobUrl: "https://remoteok.com/remote-jobs/123-senior-ai-engineer",
      title: "Senior AI Engineer",
      company: "Acme",
      location: "Worldwide",
      jobType: null,
      jobLevel: null,
      description: "Build agents & ship them.",
      salary: "150000 - 200000",
      workArrangement: "Remote",
      listingDate: "2026-07-18T09:00:00.000Z",
      source: "remoteok",
    });
  });

  it("trims whitespace, nulls empty fields and drops an unparseable date", async () => {
    const [, job] = await remoteok.fetch(ctxReturning(SAMPLE));
    expect(job.title).toBe("Full Stack Developer");
    expect(job.company).toBe("Globex");
    expect(job.location).toBeNull();
    expect(job.listingDate).toBeNull();
    expect(job.jobUrl).toBe("https://remoteok.com/remote-jobs/124-full-stack");
  });

  it("drops rows without a usable title or https url", async () => {
    const jobs = await remoteok.fetch(
      ctxReturning([
        { legal: "x" },
        { position: "", url: "https://remoteok.com/a" },
        { position: "Dev", url: "http://remoteok.com/b" },
        { position: "Dev", url: "" },
        { position: "Dev" },
      ]),
    );
    expect(jobs).toEqual([]);
  });

  it("throws when the payload is not an array", async () => {
    await expect(remoteok.fetch(ctxReturning({ jobs: [] }))).rejects.toThrow(
      /expected a JSON array/i,
    );
  });

  it("pins its host allowlist", () => {
    expect(remoteok.allowedHosts).toEqual(["remoteok.com"]);
  });
});

describe("remotive adapter", () => {
  const SAMPLE = {
    "job-count": 2,
    jobs: [
      {
        title: "AI Engineer",
        company_name: "Acme",
        candidate_required_location: "Australia",
        job_type: "full_time",
        publication_date: "2026-07-18T09:00:00",
        salary: "$150,000 - $180,000",
        url: "https://remotive.com/remote-jobs/software-dev/ai-engineer-1",
        description: "<p>Ship models.</p>",
      },
      {
        title: "Backend Developer",
        company_name: "Globex",
        candidate_required_location: "",
        job_type: "contract",
        publication_date: "",
        salary: "",
        url: "https://remotive.com/remote-jobs/software-dev/backend-2",
        description: "",
      },
    ],
  };

  it("normalizes a posting and reads the zoneless date as UTC", async () => {
    const [job] = await remotive.fetch(ctxReturning(SAMPLE));
    expect(job).toEqual({
      jobUrl: "https://remotive.com/remote-jobs/software-dev/ai-engineer-1",
      title: "AI Engineer",
      company: "Acme",
      location: "Australia",
      jobType: "full_time",
      jobLevel: null,
      description: "Ship models.",
      salary: "$150,000 - $180,000",
      workArrangement: "Remote",
      listingDate: "2026-07-18T09:00:00.000Z",
      source: "remotive",
    });
  });

  it("nulls empty optional fields", async () => {
    const [, job] = await remotive.fetch(ctxReturning(SAMPLE));
    expect(job.location).toBeNull();
    expect(job.salary).toBeNull();
    expect(job.description).toBeNull();
    expect(job.listingDate).toBeNull();
  });

  it("drops rows without a usable title or https url", async () => {
    const jobs = await remotive.fetch(
      ctxReturning({
        jobs: [
          { title: "", url: "https://remotive.com/a" },
          { title: "Dev", url: "http://remotive.com/b" },
          { title: "Dev" },
        ],
      }),
    );
    expect(jobs).toEqual([]);
  });

  it("throws when the envelope has no jobs array", async () => {
    await expect(remotive.fetch(ctxReturning({ jobs: {} }))).rejects.toThrow(
      /expected a jobs array/i,
    );
  });

  it("pins its host allowlist", () => {
    expect(remotive.allowedHosts).toEqual(["remotive.com"]);
  });
});

describe("jobicy adapter", () => {
  const SAMPLE = {
    jobCount: 2,
    jobs: [
      {
        jobTitle: "Machine Learning Engineer",
        companyName: "Acme",
        jobGeo: "Australia",
        jobType: ["full-time"],
        jobLevel: "Senior",
        pubDate: "2026-07-18 09:00:00",
        annualSalaryMin: 150000,
        annualSalaryMax: 190000,
        salaryCurrency: "USD",
        url: "https://jobicy.com/jobs/1-ml-engineer",
        jobExcerpt: "Train and serve models.",
      },
      {
        jobTitle: "Platform Engineer",
        companyName: "Globex",
        jobGeo: "",
        jobType: [],
        jobLevel: "",
        pubDate: "",
        url: "https://jobicy.com/jobs/2-platform",
        jobExcerpt: "",
      },
    ],
  };

  it("normalizes a posting and reads the spaced date as UTC", async () => {
    const [job] = await jobicy.fetch(ctxReturning(SAMPLE));
    expect(job).toEqual({
      jobUrl: "https://jobicy.com/jobs/1-ml-engineer",
      title: "Machine Learning Engineer",
      company: "Acme",
      location: "Australia",
      jobType: "full-time",
      jobLevel: "Senior",
      description: "Train and serve models.",
      salary: "150000 - 190000 USD",
      workArrangement: "Remote",
      listingDate: "2026-07-18T09:00:00.000Z",
      source: "jobicy",
    });
  });

  it("joins a multi-value jobType array", async () => {
    const jobs = await jobicy.fetch(
      ctxReturning({
        jobs: [
          {
            jobTitle: "Dev",
            url: "https://jobicy.com/jobs/3",
            jobType: ["full-time", "contract"],
          },
        ],
      }),
    );
    expect(jobs[0].jobType).toBe("full-time, contract");
  });

  it("nulls empty optional fields", async () => {
    const [, job] = await jobicy.fetch(ctxReturning(SAMPLE));
    expect(job.location).toBeNull();
    expect(job.jobType).toBeNull();
    expect(job.jobLevel).toBeNull();
    expect(job.salary).toBeNull();
    expect(job.description).toBeNull();
    expect(job.listingDate).toBeNull();
  });

  it("drops rows without a usable title or https url", async () => {
    const jobs = await jobicy.fetch(
      ctxReturning({
        jobs: [
          { jobTitle: "", url: "https://jobicy.com/a" },
          { jobTitle: "Dev", url: "http://jobicy.com/b" },
          { jobTitle: "Dev" },
        ],
      }),
    );
    expect(jobs).toEqual([]);
  });

  it("throws when the envelope has no jobs array", async () => {
    await expect(jobicy.fetch(ctxReturning({ jobs: null }))).rejects.toThrow(
      /expected a jobs array/i,
    );
  });

  it("pins its host allowlist", () => {
    expect(jobicy.allowedHosts).toEqual(["jobicy.com"]);
  });
});

describe("every adapter", () => {
  it("only ever reaches its own pinned hosts", async () => {
    for (const adapter of [remoteok, remotive, jobicy]) {
      const seen: string[][] = [];
      const ctx: SourceContext = {
        fetchJson: async (_url, allowedHosts) => {
          seen.push([...allowedHosts]);
          return adapter.id === "remoteok" ? [] : { jobs: [] };
        },
      };
      await adapter.fetch(ctx);
      // The allowlist an adapter passes to the gateway must be its own, so a
      // future edit cannot widen egress without changing the pinned list.
      expect(seen).toEqual([[...adapter.allowedHosts]]);
    }
  });
});
