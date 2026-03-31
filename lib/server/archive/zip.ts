import { deflateRawSync } from "node:zlib";

type ZipEntry = { name: string; content: string | Buffer };

/* ── CRC-32 lookup table (ISO 3309 / ITU-T V.42 polynomial) ── */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ── DOS date/time encoding ── */

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | ((seconds >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);

  return { dosTime, dosDate };
}

/* ── Little-endian write helpers ── */

function writeUint16LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

/* ── ZIP construction ── */

type ProcessedEntry = {
  nameBytes: Uint8Array;
  uncompressedData: Uint8Array;
  compressedData: Uint8Array;
  crc: number;
  uncompressedSize: number;
  compressedSize: number;
  localHeaderOffset: number;
};

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const COMPRESSION_DEFLATE = 8;
const VERSION_NEEDED = 20; // 2.0
const VERSION_MADE_BY = 20; // 2.0, MS-DOS compatible
const UTF8_FLAG = 1 << 11; // bit 11 = Language encoding flag (UTF-8)

function buildLocalFileHeader(entry: ProcessedEntry, dosTime: number, dosDate: number): Uint8Array {
  const header = new Uint8Array(30 + entry.nameBytes.length);
  writeUint32LE(header, 0, LOCAL_FILE_HEADER_SIG);
  writeUint16LE(header, 4, VERSION_NEEDED);
  writeUint16LE(header, 6, UTF8_FLAG);
  writeUint16LE(header, 8, COMPRESSION_DEFLATE);
  writeUint16LE(header, 10, dosTime);
  writeUint16LE(header, 12, dosDate);
  writeUint32LE(header, 14, entry.crc);
  writeUint32LE(header, 18, entry.compressedSize);
  writeUint32LE(header, 22, entry.uncompressedSize);
  writeUint16LE(header, 26, entry.nameBytes.length);
  writeUint16LE(header, 28, 0); // extra field length
  header.set(entry.nameBytes, 30);
  return header;
}

function buildCentralDirHeader(
  entry: ProcessedEntry,
  dosTime: number,
  dosDate: number,
): Uint8Array {
  const header = new Uint8Array(46 + entry.nameBytes.length);
  writeUint32LE(header, 0, CENTRAL_DIR_HEADER_SIG);
  writeUint16LE(header, 4, VERSION_MADE_BY);
  writeUint16LE(header, 6, VERSION_NEEDED);
  writeUint16LE(header, 8, UTF8_FLAG);
  writeUint16LE(header, 10, COMPRESSION_DEFLATE);
  writeUint16LE(header, 12, dosTime);
  writeUint16LE(header, 14, dosDate);
  writeUint32LE(header, 16, entry.crc);
  writeUint32LE(header, 20, entry.compressedSize);
  writeUint32LE(header, 24, entry.uncompressedSize);
  writeUint16LE(header, 28, entry.nameBytes.length);
  writeUint16LE(header, 30, 0); // extra field length
  writeUint16LE(header, 32, 0); // file comment length
  writeUint16LE(header, 34, 0); // disk number start
  writeUint16LE(header, 36, 0); // internal file attributes
  writeUint32LE(header, 38, 0); // external file attributes
  writeUint32LE(header, 42, entry.localHeaderOffset);
  header.set(entry.nameBytes, 46);
  return header;
}

function buildEOCD(
  entryCount: number,
  centralDirSize: number,
  centralDirOffset: number,
): Uint8Array {
  const eocd = new Uint8Array(22);
  writeUint32LE(eocd, 0, EOCD_SIG);
  writeUint16LE(eocd, 4, 0); // disk number
  writeUint16LE(eocd, 6, 0); // disk with central dir
  writeUint16LE(eocd, 8, entryCount); // entries on this disk
  writeUint16LE(eocd, 10, entryCount); // total entries
  writeUint32LE(eocd, 12, centralDirSize);
  writeUint32LE(eocd, 16, centralDirOffset);
  writeUint16LE(eocd, 20, 0); // comment length
  return eocd;
}

/** Sanitize ZIP entry names: prevent path traversal, normalize separators */
function sanitizeEntryName(name: string): string {
  const clean = name.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = clean.split("/").filter((p) => p !== "" && p !== ".");
  const safe: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      safe.pop();
    } else {
      safe.push(part);
    }
  }
  return safe.join("/") || "file";
}

/**
 * Create a ZIP archive from a list of file entries.
 * ZIP32 format: max ~4 GB uncompressed, max 65535 entries. No ZIP64 support.
 * Compatible with Windows Explorer, macOS Archive Utility, and unzip CLI.
 */
export function createZip(files: ZipEntry[]): Buffer {
  if (files.length > 65535) throw new Error("createZip: ZIP32 format supports at most 65535 entries");
  const encoder = new TextEncoder();
  const now = new Date();
  const { dosTime, dosDate } = toDosDateTime(now);

  // Phase 1: compress all entries and calculate sizes
  const parts: Uint8Array[] = [];
  const entries: ProcessedEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(sanitizeEntryName(file.name));
    const uncompressedData =
      typeof file.content === "string" ? encoder.encode(file.content) : new Uint8Array(file.content);
    const compressedData = new Uint8Array(deflateRawSync(uncompressedData));
    const crc = crc32(uncompressedData);

    const entry: ProcessedEntry = {
      nameBytes,
      uncompressedData,
      compressedData,
      crc,
      uncompressedSize: uncompressedData.length,
      compressedSize: compressedData.length,
      localHeaderOffset: offset,
    };

    const localHeader = buildLocalFileHeader(entry, dosTime, dosDate);
    parts.push(localHeader);
    parts.push(compressedData);
    offset += localHeader.length + compressedData.length;
    entries.push(entry);
  }

  // Phase 2: build central directory
  const centralDirOffset = offset;
  const centralDirParts: Uint8Array[] = [];
  let centralDirSize = 0;

  for (const entry of entries) {
    const cdHeader = buildCentralDirHeader(entry, dosTime, dosDate);
    centralDirParts.push(cdHeader);
    centralDirSize += cdHeader.length;
  }

  // Phase 3: build EOCD
  const eocd = buildEOCD(entries.length, centralDirSize, centralDirOffset);

  // Phase 4: concatenate all parts
  const totalSize = offset + centralDirSize + eocd.length;
  const result = new Uint8Array(totalSize);
  let pos = 0;

  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  for (const part of centralDirParts) {
    result.set(part, pos);
    pos += part.length;
  }
  result.set(eocd, pos);

  return Buffer.from(result);
}
