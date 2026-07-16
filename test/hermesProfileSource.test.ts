import { afterEach, describe, expect, it } from "vitest";

import {
  cp,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROFILE_SOURCE_FILES,
  loadDistributionManifest,
  validateProfileSourceTree,
} from "@/tools/hermes/packagePolicy.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "integrations", "hermes", "profile");
const temporaryRoots: string[] = [];

async function copyProfile(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "joblit-hermes-source-"));
  temporaryRoots.push(root);
  await cp(sourceRoot, root, { recursive: true, errorOnExist: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Joblit Hermes profile source", () => {
  it("contains only the exact distribution-owned source tree", async () => {
    const result = await validateProfileSourceTree(sourceRoot);

    expect(result.files).toEqual([...PROFILE_SOURCE_FILES]);
    expect(result.totalSize).toBeGreaterThan(0);
  });

  it("declares the supported stock Hermes distribution", async () => {
    const distribution = await loadDistributionManifest(sourceRoot);

    expect(distribution).toEqual({
      name: "joblit-local-ai",
      version: "0.1.0",
      description: "Grounded CV and cover-letter generation for Joblit through stock Hermes",
      hermesRequires: ">=0.18.2",
      author: "Joblit contributors",
      license: "Apache-2.0",
      distributionOwned: [
        "SOUL.md",
        "config.yaml",
        ".no-bundled-skills",
        "skills/joblit-career-agent",
      ],
    });
  });

  it("keeps API and cron isolated from MCP, memory, search, and executable tools", async () => {
    const config = await BunlessRead(path.join(sourceRoot, "config.yaml"));

    expect(config).toContain("provider: openai-codex");
    expect(config).toContain("openai_runtime: auto");
    expect(config).not.toMatch(/^\s*(?:model_slug|default_model|model_name):/m);
    expect(config).toMatch(/api_server:\s*\n\s*- no_mcp/);
    expect(config).toMatch(/cron:\s*\n\s*- no_mcp/);
    expect(config).toContain("memory_enabled: false");
    expect(config).toContain("user_profile_enabled: false");
    expect(config).toMatch(/honcho:\s*\n\s*enabled: false/);
    expect(config).not.toMatch(/^\s*(?:enabled_toolsets|mcp_servers|plugins):/m);

    expect(config).toMatch(/disabled_toolsets:\s*\n\s*- all/);
    expect(config).not.toContain("- file_operations");
    expect(config).not.toContain("- image_generation");
    expect(config).not.toContain("- text_to_speech");
  });

  it("contains no runtime state, executable payload, credential, or bundled skill", async () => {
    const result = await validateProfileSourceTree(sourceRoot);
    const lowerPaths = result.files.map((file) => file.toLowerCase());

    expect(lowerPaths.some((file) => file.endsWith(".env"))).toBe(false);
    expect(lowerPaths.some((file) => /(^|\/)(auth|session|memory|logs?|cache)(\/|\.|$)/.test(file))).toBe(false);
    expect(lowerPaths.some((file) => /\.(exe|dll|ps1|cmd|bat|py|js|mjs|cjs)$/i.test(file))).toBe(false);
    expect((await BunlessRead(path.join(sourceRoot, ".no-bundled-skills"))).trim()).toBe("");
  });

  it("documents the exact Local AI resume and cover output names", async () => {
    const outputContracts = await BunlessRead(
      path.join(
        sourceRoot,
        "skills",
        "joblit-career-agent",
        "references",
        "output-contracts.md",
      ),
    );

    expect(outputContracts).toContain("`cvSummary`");
    expect(outputContracts).toContain("`latestExperience.bullets`");
    expect(outputContracts).toContain("`skillsFinal`");
    expect(outputContracts).toContain("`cover.paragraphOne`");
    expect(outputContracts).toContain("`cover.paragraphTwo`");
    expect(outputContracts).toContain("`cover.paragraphThree`");
  });

  it.each([
    [".env", "API_SERVER_KEY=secret"],
    ["auth.json", "{}"],
    ["sessions/session.json", "{}"],
    ["memory/index.json", "{}"],
    ["logs/hermes.log", "secret"],
    ["payload.exe", "MZ"],
    ["unexpected.md", "unexpected"],
  ])("rejects forbidden or unexpected source entry %s", async (relativePath, content) => {
    const root = await copyProfile();
    const target = path.join(root, ...relativePath.split("/"));
    await writeFile(target, content, { encoding: "utf8", flag: "wx" }).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { encoding: "utf8", flag: "wx" });
    });

    await expect(validateProfileSourceTree(root)).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")("rejects case-colliding names", async () => {
    const root = await copyProfile();
    await writeFile(path.join(root, "soul.md"), "collision", "utf8");

    await expect(validateProfileSourceTree(root)).rejects.toThrow(/case collision/i);
  });

  it.skipIf(process.platform === "win32")("rejects symbolic links", async () => {
    const root = await copyProfile();
    await symlink(path.join(root, "SOUL.md"), path.join(root, "linked-soul.md"));

    await expect(validateProfileSourceTree(root)).rejects.toThrow(/symbolic link/i);
  });
});

async function BunlessRead(filePath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8");
}
