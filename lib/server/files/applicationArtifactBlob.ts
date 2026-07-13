type ApplicationArtifactTarget = "resume" | "cover";

export function buildApplicationArtifactBlobPath(input: {
  userId: string;
  jobId: string;
  target: ApplicationArtifactTarget;
  version?: string | null;
}) {
  const version = sanitizeArtifactVersion(input.version ?? "latest");
  return `applications/${input.userId}/${input.jobId}/${input.target}.${version}.pdf`;
}

export const APPLICATION_ARTIFACT_OVERWRITE_OPTIONS = {
  addRandomSuffix: false,
  allowOverwrite: true,
} as const;

function sanitizeArtifactVersion(version: string) {
  return version.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "latest";
}
