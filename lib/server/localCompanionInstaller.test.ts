import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = vi.fn(async (path: string) => Buffer.from(`contents of ${path}`));
  return { ...original, readFile, default: { ...original, readFile } };
});

import { readFile } from "node:fs/promises";
import { buildLocalCompanionInstaller } from "./localCompanionInstaller";

describe("Windows companion download", () => {
  it("packages only the install scripts and standalone runtime, using a valid ZIP directory", async () => {
    const archive = await buildLocalCompanionInstaller();
    const entries: string[] = [];
    let offset = 0;
    while (archive.readUInt32LE(offset) === 0x04034b50) {
      const size = archive.readUInt32LE(offset + 18);
      const length = archive.readUInt16LE(offset + 26);
      const name = archive.subarray(offset + 30, offset + 30 + length).toString();
      entries.push(name);
      const data = inflateRawSync(archive.subarray(offset + 30 + length, offset + 30 + length + size));
      expect(data.length).toBe(archive.readUInt32LE(offset + 22));
      expect(data.toString()).toContain(name.split("/").at(-1));
      offset += 30 + length + size;
    }
    expect(entries).toEqual(["Install.cmd", "Install.ps1", "Launch.ps1", "Manage.ps1", "Uninstall.ps1", "app/app.mjs", "app/runtime.mjs", "app/hermes.mjs", "app/storage.mjs"]);
    expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
    expect(archive.readUInt32LE(archive.length - 6)).toBe(offset);
    expect(vi.mocked(readFile)).toHaveBeenCalledTimes(9);
  });
});
