export type ArtifactBlobBody =
  | string
  | ArrayBuffer
  | Uint8Array
  | Blob;

export type ArtifactBlobObject = {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: Date;
  etag?: string;
};

export type ArtifactBlobPutInput = {
  pathname: string;
  body: ArtifactBlobBody;
  contentType: string;
};

export type ArtifactBlobPutResult = {
  pathname: string;
  url: string;
  etag?: string;
};

export type ArtifactBlobDeleteResult = {
  disposition: "deleted" | "not_found";
};

export type ArtifactBlobListInput = {
  prefix: string;
  cursor?: string;
  limit: number;
};

export type ArtifactBlobListResult = {
  blobs: ArtifactBlobObject[];
  cursor?: string;
  hasMore: boolean;
};

/**
 * The external Blob seam. The lifecycle module owns idempotency, claims,
 * retries, and inventory policy; adapters only translate Blob operations.
 */
export interface ArtifactBlobPort {
  put(input: ArtifactBlobPutInput): Promise<ArtifactBlobPutResult>;
  delete(urlOrPathname: string): Promise<ArtifactBlobDeleteResult>;
  list(input: ArtifactBlobListInput): Promise<ArtifactBlobListResult>;
}

export class ArtifactBlobPortUnavailableError extends Error {
  readonly code = "ARTIFACT_BLOB_PORT_UNAVAILABLE";
  /**
   * 503, not 409: storage being unconfigured is an environment problem that a
   * later attempt genuinely may not hit, so replaying is the correct client
   * behaviour here. It still needs a status to be rendered as a coded response
   * at all.
   */
  readonly status = 503;

  constructor(message = "Application artifact Blob storage is not configured") {
    super(message);
    this.name = "ArtifactBlobPortUnavailableError";
  }
}

export function isArtifactBlobPortUnavailable(
  error: unknown,
): error is ArtifactBlobPortUnavailableError {
  return (
    error instanceof ArtifactBlobPortUnavailableError ||
    (error instanceof Error &&
      "code" in error &&
      error.code === "ARTIFACT_BLOB_PORT_UNAVAILABLE")
  );
}
