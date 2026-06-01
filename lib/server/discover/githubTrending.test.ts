import { describe, it, expect } from "vitest";
import { parseTrendingHtml } from "./githubTrending";

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
