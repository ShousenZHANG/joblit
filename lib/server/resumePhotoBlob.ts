import type { CompileFile } from "@/lib/server/latex/compilePdf";

export const MAX_RESUME_PHOTO_BYTES = 2 * 1024 * 1024;

const PHOTO_CONTENT_TYPE_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

const ALLOWED_PHOTO_FILENAMES = new Set(["photo.jpg", "photo.png", "photo.webp"]);

type ResumePhotoContentType = keyof typeof PHOTO_CONTENT_TYPE_TO_EXT;

function normalizeResumePhotoContentType(value: string | null) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

export function toResumePhotoContentType(value: string | null): ResumePhotoContentType | null {
  const normalized = normalizeResumePhotoContentType(value);
  return normalized in PHOTO_CONTENT_TYPE_TO_EXT ? (normalized as ResumePhotoContentType) : null;
}

function getResumePhotoExtension(contentType: ResumePhotoContentType) {
  return PHOTO_CONTENT_TYPE_TO_EXT[contentType];
}

export function buildResumePhotoBlobPath(userId: string, contentType: ResumePhotoContentType) {
  return `resume-photos/${userId}/photo${getResumePhotoExtension(contentType)}`;
}

function isVercelBlobPublicHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "public.blob.vercel-storage.com" ||
    normalized.endsWith(".public.blob.vercel-storage.com")
  );
}

export function parseTrustedResumePhotoUrl(rawUrl: string, userId: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!isVercelBlobPublicHost(url.hostname)) return null;

  let path: string;
  try {
    path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }

  const expectedPrefix = `resume-photos/${userId}/`;
  if (!path.startsWith(expectedPrefix)) return null;

  const filename = path.slice(expectedPrefix.length);
  if (!ALLOWED_PHOTO_FILENAMES.has(filename)) return null;

  return url;
}

async function readResponseBodyWithLimit(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESUME_PHOTO_BYTES) {
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    if (!Number.isFinite(declaredLength) || declaredLength <= 0) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.byteLength <= MAX_RESUME_PHOTO_BYTES ? buffer : null;
  }

  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > MAX_RESUME_PHOTO_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

export async function buildResumePhotoCompileFile(response: Response): Promise<CompileFile | null> {
  const contentType = toResumePhotoContentType(response.headers.get("content-type"));
  if (!contentType) return null;

  const buffer = await readResponseBodyWithLimit(response);
  if (!buffer || buffer.byteLength === 0) return null;

  return {
    name: `photo${getResumePhotoExtension(contentType)}`,
    base64: buffer.toString("base64"),
  };
}
