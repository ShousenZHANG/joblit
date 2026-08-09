import type {
  JobExperienceAnalysis,
  JobExperienceRequirement,
} from "./analyzer";

export type VisibleJobExperienceHighlight = {
  requirementId: string;
  start: number;
  end: number;
  text: string;
};

export type VisibleJobExperienceProjection = {
  requirements: JobExperienceRequirement[];
  highlights: VisibleJobExperienceHighlight[];
};

export const EMPTY_VISIBLE_JOB_EXPERIENCE: VisibleJobExperienceProjection = {
  requirements: [],
  highlights: [],
};

function sourceMatches(
  description: string,
  requirement: JobExperienceRequirement,
): boolean {
  const { evidence } = requirement;
  return (
    Number.isInteger(evidence.start) &&
    Number.isInteger(evidence.end) &&
    Number.isInteger(evidence.yearsStart) &&
    Number.isInteger(evidence.yearsEnd) &&
    evidence.start >= 0 &&
    evidence.end >= evidence.start &&
    evidence.yearsStart >= evidence.start &&
    evidence.yearsEnd > evidence.yearsStart &&
    evidence.yearsEnd <= evidence.end &&
    evidence.end <= description.length &&
    description.slice(evidence.start, evidence.end) === evidence.text &&
    description.slice(evidence.yearsStart, evidence.yearsEnd) ===
      requirement.years.text
  );
}

/**
 * Project domain analysis into the one presentation policy used by both the
 * compact requirements row and JD highlights. Only source-verifiable REQUIRED
 * quantities survive. If filtering removes part of a relation, its remaining
 * members become standalone facts instead of presenting a false AND/OR claim.
 */
export function projectVisibleJobExperience(
  description: string,
  analysis?: JobExperienceAnalysis | null,
): VisibleJobExperienceProjection {
  if (!description || !analysis?.requirements.length) {
    return EMPTY_VISIBLE_JOB_EXPERIENCE;
  }

  const candidates = analysis.requirements
    .filter(
      (requirement) =>
        requirement.classification === "REQUIRED" &&
        sourceMatches(description, requirement),
    )
    .sort(
      (left, right) =>
        left.evidence.yearsStart - right.evidence.yearsStart ||
        left.evidence.yearsEnd - right.evidence.yearsEnd ||
        left.id.localeCompare(right.id),
    );

  const nonOverlapping: JobExperienceRequirement[] = [];
  for (const candidate of candidates) {
    const previous = nonOverlapping.at(-1);
    if (
      previous &&
      candidate.evidence.yearsStart < previous.evidence.yearsEnd
    ) {
      continue;
    }
    nonOverlapping.push(candidate);
  }

  const originalGroupCounts = new Map<string, number>();
  const visibleGroupCounts = new Map<string, number>();
  for (const requirement of analysis.requirements) {
    const groupId = requirement.relation?.groupId;
    if (groupId) {
      originalGroupCounts.set(groupId, (originalGroupCounts.get(groupId) ?? 0) + 1);
    }
  }
  for (const requirement of nonOverlapping) {
    const groupId = requirement.relation?.groupId;
    if (groupId) {
      visibleGroupCounts.set(groupId, (visibleGroupCounts.get(groupId) ?? 0) + 1);
    }
  }

  const requirements = nonOverlapping.map((requirement) => {
    const relation = requirement.relation;
    if (!relation) return requirement;
    const originalCount = originalGroupCounts.get(relation.groupId) ?? 0;
    const visibleCount = visibleGroupCounts.get(relation.groupId) ?? 0;
    if (originalCount >= 2 && visibleCount === originalCount) return requirement;
    const standalone = { ...requirement };
    delete standalone.relation;
    return standalone;
  });

  if (requirements.length === 0) return EMPTY_VISIBLE_JOB_EXPERIENCE;
  return {
    requirements,
    highlights: requirements.map((requirement) => ({
      requirementId: requirement.id,
      start: requirement.evidence.yearsStart,
      end: requirement.evidence.yearsEnd,
      text: requirement.years.text,
    })),
  };
}
