import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import LoadingJobs from "./jobs/loading";
import AppLayout from "./layout";

const localeState = vi.hoisted(() => ({
  messages: {} as Record<string, Record<string, string>>,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve(
      (key: string) => localeState.messages[namespace]?.[key] ?? `${namespace}.${key}`,
    ),
}));

vi.mock("@/components/app-shell/AppNav", () => ({
  AppNav: () => <nav aria-label="Application" />,
}));

vi.mock("@/components/app-shell/CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("../GuideContext", () => ({
  GuideProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../RouteTransition", () => ({
  RouteTransition: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="route-transition">{children}</div>
  ),
}));

const appDirectory = join(process.cwd(), "app", "(app)");
const layoutSource = readFileSync(join(appDirectory, "layout.tsx"), "utf8");
const globalCss = readFileSync(
  join(process.cwd(), "app", "globals.css"),
  "utf8",
).replace(/\r\n/g, "\n");

function findClosingBrace(source: string, openingBrace: number) {
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error("Unclosed CSS block");
}

function extractMediaBlocks(marker: string) {
  const blocks: string[] = [];
  let searchFrom = 0;
  let markerIndex = globalCss.indexOf(marker, searchFrom);

  while (markerIndex >= 0) {
    const openingBrace = globalCss.indexOf("{", markerIndex);
    const closingBrace = findClosingBrace(globalCss, openingBrace);
    blocks.push(globalCss.slice(openingBrace + 1, closingBrace));
    searchFrom = closingBrace + 1;
    markerIndex = globalCss.indexOf(marker, searchFrom);
  }

  return blocks;
}

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [entryPath] : [];
  });
}

async function renderLayout(
  messages = en,
  children: React.ReactNode = <div>Workspace</div>,
) {
  localeState.messages = messages as unknown as Record<string, Record<string, string>>;
  return render(await AppLayout({ children }));
}

describe("AppLayout", () => {
  beforeEach(() => {
    localeState.messages = en as unknown as Record<string, Record<string, string>>;
  });

  afterEach(cleanup);

  it("puts a skip link before navigation and wraps routes in a focusable main landmark", async () => {
    await renderLayout();

    const skipLink = screen.getByRole("link", { name: "Skip to content" });
    const navigation = screen.getByRole("navigation", { name: "Application" });
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(
      Boolean(skipLink.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveClass("flex", "min-h-0", "flex-1", "flex-col", "outline-none");
    expect(within(main).getByTestId("route-transition")).toHaveTextContent("Workspace");
  });

  it("localizes the skip link in Chinese", async () => {
    await renderLayout(zh);

    expect(screen.getByRole("link", { name: "跳到正文" })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });

  it("renders exactly two workspace atmosphere layers without Starfield", async () => {
    const { container } = await renderLayout();
    const atmosphere = container.querySelector(".workspace-atmosphere");

    expect(atmosphere).not.toBeNull();
    expect(
      Array.from(atmosphere?.children ?? []).map((layer) => ({
        className: layer.className,
        tagName: layer.tagName,
      })),
    ).toEqual([
      { className: "workspace-atmosphere__aurora", tagName: "SPAN" },
      { className: "workspace-atmosphere__nebula", tagName: "SPAN" },
    ]);
    expect(container.querySelector(".starfield")).toBeNull();
    expect(layoutSource).not.toMatch(/\bStarfield\b/);
  });

  it.each(["@media (pointer: coarse)", "@media (prefers-reduced-motion: reduce)"])(
    "keeps the workspace atmosphere static inside %s",
    (marker) => {
      const workspaceRule =
        /\.dark \.workspace-atmosphere > span\s*\{[^}]*animation:\s*none;[^}]*transform:\s*none;[^}]*will-change:\s*auto;/;

      expect(extractMediaBlocks(marker)).toEqual(
        expect.arrayContaining([expect.stringMatching(workspaceRule)]),
      );
    },
  );

  it("keeps one main landmark when the shell renders authenticated route content", async () => {
    const { container } = await renderLayout(en, <LoadingJobs />);

    const mainLandmarks = container.querySelectorAll("main");
    expect(mainLandmarks).toHaveLength(1);
    expect(mainLandmarks[0]).toHaveAttribute("id", "main-content");
  });

  it("reserves main elements in authenticated app source for the shell layout", () => {
    const shellLayout = join(appDirectory, "layout.tsx");
    const offenders = collectTsxFiles(appDirectory)
      .filter((file) => file !== shellLayout && !file.endsWith(".test.tsx"))
      .filter((file) => /<\/?main\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(appDirectory, file).replaceAll("\\", "/"))
      .sort();

    expect(offenders).toEqual([]);
  });
});
