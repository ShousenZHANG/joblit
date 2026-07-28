import { createHash } from "node:crypto";

export class ApplicationArtifactVersionError extends Error {
  constructor() {
    super("Invalid artifact content version");
    this.name = "ApplicationArtifactVersionError";
  }
}

function sanitizeContentVersion(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) {
    throw new ApplicationArtifactVersionError();
  }
  return (
    trimmed.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 45) || "artifact"
  );
}

/**
 * Stable prefix shared by immutable-path construction and readers that need to
 * recognize whether an existing artifact belongs to one content version.
 */
export function buildApplicationArtifactVersionPrefix(
  contentVersion: string,
): string {
  const sanitizedVersion = sanitizeContentVersion(contentVersion);
  const versionIdentity = createHash("sha256")
    .update(contentVersion)
    .digest("hex")
    .slice(0, 8);
  return `${sanitizedVersion}-${versionIdentity}-`;
}
