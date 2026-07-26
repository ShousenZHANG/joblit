import { beforeEach, describe, expect, it, vi } from "vitest";

const blobSdk = vi.hoisted(() => {
  class MockBlobNotFoundError extends Error {}
  return {
    BlobNotFoundError: MockBlobNotFoundError,
    del: vi.fn(),
    list: vi.fn(),
    put: vi.fn(),
  };
});

vi.mock("@vercel/blob", () => blobSdk);

import { ArtifactBlobPortUnavailableError } from "./artifactBlobPort";
import { createVercelArtifactBlobAdapter } from "./vercelBlobAdapter";

describe("Vercel artifact Blob adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails with a typed unavailable error before calling the SDK when the token is missing", async () => {
    const adapter = createVercelArtifactBlobAdapter({ token: "" });

    await expect(
      adapter.put({
        pathname: "applications/user/job/resume.v1.pdf",
        body: "pdf",
        contentType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(ArtifactBlobPortUnavailableError);
    expect(blobSdk.put).not.toHaveBeenCalled();
  });

  it("uses deterministic immutable retry options for put", async () => {
    blobSdk.put.mockResolvedValue({
      pathname: "applications/user/job/resume.v1.pdf",
      url: "https://blob.example/resume.v1.pdf",
      etag: "etag-1",
    });
    const adapter = createVercelArtifactBlobAdapter({ token: "blob-token" });

    await expect(
      adapter.put({
        pathname: "applications/user/job/resume.v1.pdf",
        body: new Uint8Array([1, 2, 3]),
        contentType: "application/pdf",
      }),
    ).resolves.toEqual({
      pathname: "applications/user/job/resume.v1.pdf",
      url: "https://blob.example/resume.v1.pdf",
      etag: "etag-1",
    });
    expect(blobSdk.put).toHaveBeenCalledWith(
      "applications/user/job/resume.v1.pdf",
      expect.anything(),
      {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/pdf",
        token: "blob-token",
      },
    );
  });

  it("normalizes BlobNotFoundError into an idempotent delete success", async () => {
    blobSdk.del.mockRejectedValue(new blobSdk.BlobNotFoundError("gone"));
    const adapter = createVercelArtifactBlobAdapter({ token: "blob-token" });

    await expect(
      adapter.delete("https://blob.example/gone.pdf"),
    ).resolves.toEqual({ disposition: "not_found" });
    expect(blobSdk.del).toHaveBeenCalledWith(
      "https://blob.example/gone.pdf",
      { token: "blob-token" },
    );
  });

  it("maps list prefix, cursor, and page metadata without dropping inventory fields", async () => {
    const uploadedAt = new Date("2026-07-26T00:00:00.000Z");
    blobSdk.list.mockResolvedValue({
      blobs: [
        {
          pathname: "applications/user/job/resume.v1.pdf",
          url: "https://blob.example/resume.v1.pdf",
          size: 42,
          uploadedAt,
          etag: "etag-1",
        },
      ],
      cursor: "next-cursor",
      hasMore: true,
    });
    const adapter = createVercelArtifactBlobAdapter({ token: "blob-token" });

    await expect(
      adapter.list({
        prefix: "applications/",
        cursor: "current-cursor",
        limit: 100,
      }),
    ).resolves.toEqual({
      blobs: [
        {
          pathname: "applications/user/job/resume.v1.pdf",
          url: "https://blob.example/resume.v1.pdf",
          size: 42,
          uploadedAt,
          etag: "etag-1",
        },
      ],
      cursor: "next-cursor",
      hasMore: true,
    });
    expect(blobSdk.list).toHaveBeenCalledWith({
      token: "blob-token",
      prefix: "applications/",
      cursor: "current-cursor",
      limit: 100,
    });
  });
});
