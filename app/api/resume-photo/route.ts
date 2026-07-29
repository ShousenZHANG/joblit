import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { put, del } from "@vercel/blob";
import {
  buildResumePhotoBlobPath,
  MAX_RESUME_PHOTO_BYTES,
  parseTrustedResumePhotoUrl,
  toResumePhotoContentType,
} from "@/lib/server/resumePhotoBlob";
import { getRuntimeCapabilities } from "@/lib/server/runtimeCapabilities";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const capability = getRuntimeCapabilities().blobStorage;
    if (capability.kind !== "enabled") {
      return NextResponse.json(
        { error: { code: "BLOB_NOT_CONFIGURED", message: "Blob storage not configured" }, requestId },
        { status: 503 },
      );
    }
    const token = capability.config.token;

    const contentType = toResumePhotoContentType(req.headers.get("content-type"));
    if (!contentType) {
      return NextResponse.json(
        { error: { code: "INVALID_TYPE", message: "Only JPEG, PNG, and WebP are allowed" }, requestId },
        { status: 400 },
      );
    }

    const body = await req.arrayBuffer();
    if (body.byteLength > MAX_RESUME_PHOTO_BYTES) {
      return NextResponse.json(
        { error: { code: "TOO_LARGE", message: "Photo must be under 2 MB" }, requestId },
        { status: 400 },
      );
    }

    const blobPath = buildResumePhotoBlobPath(userId, contentType);

    const blob = await put(blobPath, Buffer.from(body), {
      access: "public",
      contentType,
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({ url: blob.url, requestId });
  });
}

export async function DELETE(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const capability = getRuntimeCapabilities().blobStorage;
    if (capability.kind !== "enabled") {
      return NextResponse.json(
        { error: { code: "BLOB_NOT_CONFIGURED", message: "Blob storage not configured" }, requestId },
        { status: 503 },
      );
    }
    const token = capability.config.token;

    const { searchParams } = new URL(req.url);
    const photoUrl = searchParams.get("url");
    if (photoUrl) {
      const trustedPhotoUrl = parseTrustedResumePhotoUrl(photoUrl, userId);
      if (!trustedPhotoUrl) {
        return NextResponse.json(
          { error: { code: "INVALID_PHOTO_URL", message: "Photo URL is not owned by this profile" }, requestId },
          { status: 400 },
        );
      }
      await Promise.resolve(del(trustedPhotoUrl.toString(), { token })).catch(() => {});
    }

    return NextResponse.json({ ok: true, requestId });
  });
}
