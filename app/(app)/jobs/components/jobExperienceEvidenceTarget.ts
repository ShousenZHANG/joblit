/** Stable DOM target shared by the compact requirement row and its JD mark. */
export function experienceEvidenceTargetId(requirementId: string): string {
  return `jd-experience-${encodeURIComponent(requirementId)}`;
}
