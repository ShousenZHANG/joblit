import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

// A fixed file allowlist keeps repository configuration and credentials out of
// the downloadable package. The Windows installer provisions its own runtime.
const PACKAGE_FILES = [
  ["windows/Install.cmd", "Install.cmd"],
  ["windows/Install.ps1", "Install.ps1"],
  ["windows/Launch.ps1", "Launch.ps1"],
  ["windows/Manage.ps1", "Manage.ps1"],
  ["windows/Uninstall.ps1", "Uninstall.ps1"],
  ["app.mjs", "app/app.mjs"],
  ["runtime.mjs", "app/runtime.mjs"],
  ["hermes.mjs", "app/hermes.mjs"],
  ["storage.mjs", "app/storage.mjs"],
] as const;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A small, deterministic ZIP writer for the explicitly named files. */
function packageZip(entries: { name: string; data: Buffer }[]): Buffer {
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const filename = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 file names.
    local.writeUInt16LE(8, 8); // DEFLATE.
    local.writeUInt16LE(0x21, 12); // 1980-01-01, a valid deterministic DOS date.
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    files.push(local, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, centralDirectory, end]);
}

export async function buildLocalCompanionInstaller(): Promise<Buffer> {
  const root = join(process.cwd(), "tools", "companion");
  const entries = await Promise.all(PACKAGE_FILES.map(async ([source, name]) => ({
    name,
    data: await readFile(join(root, source)),
  })));
  return packageZip(entries);
}
