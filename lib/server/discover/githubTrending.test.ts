import { beforeEach, describe, it, expect, vi } from "vitest";

const safeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/net/safeFetch", () => ({
  safeOutboundFetch: safeFetchMock,
}));

import {
  fetchTrendingRepos,
  parseTrendingHtml,
  filterTrendingNoise,
  isMostlyCjk,
  isLowSignalRepo,
} from "./githubTrending";
import type { TrendingRepo } from "@/app/(app)/discover/types";

function fakeRepo(over: Partial<TrendingRepo> = {}): TrendingRepo {
  return {
    id: 1,
    fullName: "acme/widget",
    description: "A fast widget framework.",
    url: "https://github.com/acme/widget",
    stars: 1000,
    forks: 10,
    starsGained: 100,
    language: "TypeScript",
    topics: [],
    ownerAvatar: "",
    pushedAt: "",
    ...over,
  };
}

// Minimal fixture mirroring the github.com/trending row markup.
function article({
  owner,
  repo,
  desc,
  lang,
  stars,
  forks,
  gained,
}: {
  owner: string;
  repo: string;
  desc: string;
  lang?: string;
  stars: string;
  forks: string;
  gained: string;
}): string {
  const langSpan = lang
    ? `<span class="d-inline-block ml-0 mr-3"><span class="repo-language-color" style="background-color: #3178c6"></span><span itemprop="programmingLanguage">${lang}</span></span>`
    : "";
  return `<article class="Box-row">
    <h2 class="h3 lh-condensed">
      <a href="/${owner}/${repo}" class="Link"><span class="text-normal">${owner} /</span>${repo}</a>
    </h2>
    <p class="col-9 color-fg-muted my-1 pr-4">${desc}</p>
    <div class="f6 color-fg-muted mt-2">
      ${langSpan}
      <a href="/${owner}/${repo}/stargazers" class="Link--muted d-inline-block mr-3"><svg></svg>${stars}</a>
      <a href="/${owner}/${repo}/forks" class="Link--muted d-inline-block mr-3"><svg></svg>${forks}</a>
      <span class="d-inline-block float-sm-right"><svg></svg>${gained} stars this month</span>
    </div>
  </article>`;
}

const FIXTURE = `<div class="Box">
  ${article({ owner: "openai", repo: "whisper", desc: "Robust speech recognition via &amp; large-scale weak supervision.", lang: "Python", stars: "75,123", forks: "8,901", gained: "1,234" })}
  ${article({ owner: "vercel", repo: "next.js", desc: "The React Framework.", lang: "TypeScript", stars: "120,000", forks: "25,000", gained: "987" })}
</div>`;

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("fetchTrendingRepos", () => {
  it("uses the exact GitHub host allowlist and bounded response policy", async () => {
    safeFetchMock.mockResolvedValueOnce(
      new Response(FIXTURE, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const repos = await fetchTrendingRepos("weekly");

    expect(repos.map((repo) => repo.fullName)).toEqual([
      "openai/whisper",
      "vercel/next.js",
    ]);
    expect(safeFetchMock).toHaveBeenCalledWith(
      "https://github.com/trending?since=weekly",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "text/html,application/xhtml+xml",
        }),
      }),
      {
        allowedHosts: ["github.com"],
        timeoutMs: 8_000,
        maxResponseBytes: 1024 * 1024,
        maxRedirects: 0,
      },
    );
  });

  it("rejects an empty parse so a markup change cannot overwrite last-known-good", async () => {
    safeFetchMock.mockResolvedValueOnce(
      new Response("<html><body>changed markup</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(fetchTrendingRepos("monthly")).rejects.toThrow(
      "GitHub trending returned no repository rows",
    );
  });
});

describe("parseTrendingHtml", () => {
  it("parses repos in document order", () => {
    const repos = parseTrendingHtml(FIXTURE);
    expect(repos).toHaveLength(2);
    expect(repos.map((r) => r.fullName)).toEqual(["openai/whisper", "vercel/next.js"]);
  });

  it("extracts the core fields per repo", () => {
    const [whisper] = parseTrendingHtml(FIXTURE);
    expect(whisper.fullName).toBe("openai/whisper");
    expect(whisper.url).toBe("https://github.com/openai/whisper");
    expect(whisper.language).toBe("Python");
    expect(whisper.stars).toBe(75123);
    expect(whisper.forks).toBe(8901);
    expect(whisper.starsGained).toBe(1234);
    expect(whisper.ownerAvatar).toBe("https://github.com/openai.png?size=48");
  });

  it("decodes HTML entities in the description", () => {
    const [whisper] = parseTrendingHtml(FIXTURE);
    expect(whisper.description).toBe(
      "Robust speech recognition via & large-scale weak supervision.",
    );
  });

  it("derives a stable numeric id from the full name", () => {
    const a = parseTrendingHtml(FIXTURE);
    const b = parseTrendingHtml(FIXTURE);
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).not.toBe(a[1].id);
    expect(Number.isInteger(a[0].id)).toBe(true);
  });

  it("handles a repo with no language gracefully", () => {
    const html = article({
      owner: "torvalds",
      repo: "linux",
      desc: "Linux kernel source tree.",
      stars: "180,000",
      forks: "53,000",
      gained: "450",
    });
    const [linux] = parseTrendingHtml(`<div>${html}</div>`);
    expect(linux.language).toBeNull();
    expect(linux.stars).toBe(180000);
  });

  it("returns an empty array for markup with no repo rows", () => {
    expect(parseTrendingHtml("<div>nothing here</div>")).toEqual([]);
  });
});

describe("filterTrendingNoise", () => {
  it("keeps a genuine software repo", () => {
    const kept = filterTrendingNoise([fakeRepo()]);
    expect(kept).toHaveLength(1);
  });

  it("drops mostly-CJK listings", () => {
    expect(isMostlyCjk("最全面的前端面试题学习资料")).toBe(true);
    const out = filterTrendingNoise([
      fakeRepo({ fullName: "x/interview-cn", description: "最全面的前端面试题学习资料大全" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("drops awesome-list / roadmap archetypes", () => {
    expect(isLowSignalRepo("foo/awesome-python", "x")).toBe(true);
    const out = filterTrendingNoise([
      fakeRepo({ fullName: "foo/awesome-python", description: "A curated list of Python." }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("drops description-less rows", () => {
    expect(filterTrendingNoise([fakeRepo({ description: null })])).toHaveLength(0);
  });

  it("keeps a mostly-English repo with a couple CJK chars", () => {
    expect(isMostlyCjk("Vite plugin for 中文 docs")).toBe(false);
    const out = filterTrendingNoise([
      fakeRepo({ fullName: "v/vite-cn", description: "Vite plugin for 中文 docs" }),
    ]);
    expect(out).toHaveLength(1);
  });
});
