import {
  BlobNotFoundError,
  del,
  list,
  put,
  type PutCommandOptions,
} from "@vercel/blob";

import {
  ArtifactBlobPortUnavailableError,
  type ArtifactBlobPort,
} from "./artifactBlobPort";

type VercelArtifactBlobAdapterOptions = {
  token?: string | null;
};

function configuredToken(explicit: string | null | undefined): string {
  const token = (explicit ?? process.env.BLOB_READ_WRITE_TOKEN ?? "").trim();
  if (!token) throw new ArtifactBlobPortUnavailableError();
  return token;
}

/**
 * Production adapter for Vercel Blob.
 *
 * `allowOverwrite` is safe here only because lifecycle paths bind both the
 * caller's content version and the SHA-256 of the bytes. It therefore retries
 * one immutable object; it never turns a pathname into a mutable pointer.
 */
export function createVercelArtifactBlobAdapter(
  options: VercelArtifactBlobAdapterOptions = {},
): ArtifactBlobPort {
  return {
    async put(input) {
      const token = configuredToken(options.token);
      const body =
        input.body instanceof Uint8Array
          ? Buffer.from(input.body)
          : input.body instanceof ArrayBuffer
            ? Buffer.from(input.body)
            : input.body;
      const result = await put(input.pathname, body, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: input.contentType,
        token,
      } satisfies PutCommandOptions);
      return {
        pathname: result.pathname,
        url: result.url,
        ...("etag" in result && typeof result.etag === "string"
          ? { etag: result.etag }
          : {}),
      };
    },

    async delete(urlOrPathname) {
      const token = configuredToken(options.token);
      try {
        await del(urlOrPathname, { token });
        return { disposition: "deleted" };
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          return { disposition: "not_found" };
        }
        throw error;
      }
    },

    async list(input) {
      const token = configuredToken(options.token);
      const result = await list({
        token,
        prefix: input.prefix,
        cursor: input.cursor,
        limit: input.limit,
      });
      return {
        blobs: result.blobs.map((blob) => ({
          pathname: blob.pathname,
          url: blob.url,
          size: blob.size,
          uploadedAt: blob.uploadedAt,
          etag: blob.etag,
        })),
        ...(result.cursor ? { cursor: result.cursor } : {}),
        hasMore: result.hasMore,
      };
    },
  };
}

export const vercelArtifactBlobPort = createVercelArtifactBlobAdapter();
