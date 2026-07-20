export type ExperienceRequirementSignal = {
  key: string;
  /** Prefixed with Required/Preferred, for surfaces that show one flat list. */
  label: string;
  /**
   * The constraint alone. Surfaces that group by `isRequired` use this so the
   * qualifier is not repeated on every chip inside a group that already says
   * it — "Preferred: 5+ years" under a "Preferred" heading is noise.
   */
  shortLabel: string;
  evidence: string;
  minYears: number;
  isRequired: boolean;
};

const EXPERIENCE_SOFT_RE =
  /\b(preferred|nice to have|nice-to-have|bonus|desired|desirable|optional|a plus|ideally|advantageous)\b/i;
const EXPERIENCE_HARD_RE =
  /\b(require|requires|required|requirements|qualification|qualifications|minimum|at least|must|essential|mandatory)\b/i;
const NEGATED_REQUIREMENT_RE =
  /\b(?:is|are|was|were)?\s*not\s+(?:\w+\s+){0,4}(?:required|necessary|essential|mandatory)\b|\bno\s+(?:prior\s+)?(?:\w+\s+){0,4}(?:is\s+)?required\b|\bwe do not require\b/i;
const EXPERIENCE_CONTEXT_RE =
  /\b(experience|exp|background|track record|proficiency|expertise|hands-on|professional)\b/i;
const COMPANY_TENURE_RE =
  /\b(for|over|more than|around|about|nearly|almost|since)\b.*\b(company|startup|business|organisation|organization|team|firm|history|founded)\b/i;

// Additional signal detectors
const DEGREE_RE = /\b(bachelor'?s?|master'?s?|phd|doctorate|degree|bs|ms|b\.s\.|m\.s\.|computer science|information technology|related field|tertiary|university)\b/i;
const CLEARANCE_RE = /\b(security clearance|top secret|ts\/sci|secret clearance|clearance required|public trust|baseline clearance|nv1|nv2|negative vetting)\b/i;
const CITIZENSHIP_RE = /\b(citizen(ship)?|permanent resident|pr holder|work rights|authorized to work|visa sponsor|no sponsor|right to work|unrestricted work)\b/i;
const SPONSORSHIP_OFFERED_RE =
  /\b(visa sponsorship (?:is )?(?:available|offered|provided)|we (?:can |do )?sponsor|sponsorship support)\b/i;
const LOCATION_MODE_RE = /\b(fully remote|remote[- ]first|hybrid|on[- ]?site|in[- ]?office|work from home|wfh)\b/i;

export function parseExperienceGate(description: string): ExperienceRequirementSignal[] {
  if (!description) return [];
  const normalized = description
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!normalized) return [];

  const segments = normalized
    .split(/[\n.;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const output: ExperienceRequirementSignal[] = [];
  const seen = new Set<string>();

  const emit = (
    label: string,
    minYears: number,
    segment: string,
    isRequired: boolean,
  ) => {
    const key = `${label.toLowerCase()}|${isRequired ? "required" : "preferred"}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push({
      key,
      label: `${isRequired ? "Required" : "Preferred"}: ${label}`,
      shortLabel: label,
      evidence: segment,
      minYears,
      isRequired,
    });
  };

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (COMPANY_TENURE_RE.test(lower) && !EXPERIENCE_CONTEXT_RE.test(lower)) continue;

    const soft = EXPERIENCE_SOFT_RE.test(lower);
    const hard = EXPERIENCE_HARD_RE.test(lower);
    const hasExperienceContext = EXPERIENCE_CONTEXT_RE.test(lower);
    if (!hasExperienceContext && !hard && !soft) continue;

    let matched = false;

    const rangeMatch = segment.match(/\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b/i);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const minYears = Math.min(start, end);
        const maxYears = Math.max(start, end);
        emit(`${minYears}-${maxYears} years`, minYears, segment, hard && !soft);
        matched = true;
      }
    }

    const plusMatch = segment.match(/\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i);
    if (plusMatch) {
      const years = Number(plusMatch[1]);
      if (Number.isFinite(years)) {
        emit(`${years}+ years`, years, segment, hard && !soft);
        matched = true;
      }
    }

    if (!matched) {
      const plainMatch = segment.match(
        /\b(\d{1,2})\s*(?:years?|yrs?)\b(?:\s*(?:of|in))?\s*(?:\w+\s+){0,3}(?:experience|exp|role|position|industry|field)\b/i,
      );
      if (plainMatch) {
        const years = Number(plainMatch[1]);
        if (Number.isFinite(years)) {
          emit(`${years}+ years`, years, segment, hard && !soft);
        }
      }
    }
  }

  // Detect degree requirements
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (!DEGREE_RE.test(lower)) continue;
    const hard = EXPERIENCE_HARD_RE.test(lower);
    const soft = EXPERIENCE_SOFT_RE.test(lower);
    const degreeMatch = lower.match(/\b(bachelor|master|phd|doctorate)\b/i);
    const label = degreeMatch
      ? `${degreeMatch[1].charAt(0).toUpperCase()}${degreeMatch[1].slice(1)}'s degree`
      : "Degree required";
    const hasEquivalentAlternative =
      /\bor equivalent (?:experience|qualification)\b/i.test(segment);
    emit(
      hasEquivalentAlternative ? `${label} or equivalent experience` : label,
      0,
      segment,
      hard && !soft && !hasEquivalentAlternative,
    );
    break; // Only first degree signal
  }

  // Detect clearance requirements
  for (const segment of segments) {
    if (!CLEARANCE_RE.test(segment)) continue;
    if (NEGATED_REQUIREMENT_RE.test(segment)) continue;
    const soft = EXPERIENCE_SOFT_RE.test(segment);
    emit(`Security clearance`, 0, segment, !soft);
    break;
  }

  // Detect citizenship/work rights
  for (const segment of segments) {
    if (!CITIZENSHIP_RE.test(segment)) continue;
    if (NEGATED_REQUIREMENT_RE.test(segment)) continue;
    if (SPONSORSHIP_OFFERED_RE.test(segment)) continue;
    const soft = EXPERIENCE_SOFT_RE.test(segment);
    const noSponsor = /\bno\s*sponsor|without\s*sponsor/i.test(segment);
    emit(
      noSponsor ? "No visa sponsorship" : "Work rights required",
      0,
      segment,
      !soft,
    );
    break;
  }

  // Detect location mode
  for (const segment of segments) {
    const match = segment.match(LOCATION_MODE_RE);
    if (!match) continue;
    const mode = match[0].trim();
    const soft = EXPERIENCE_SOFT_RE.test(segment);
    const hard = EXPERIENCE_HARD_RE.test(segment);
    emit(
      mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase(),
      0,
      segment,
      hard && !soft,
    );
    break;
  }

  return output
    .sort((a, b) => {
      if (a.isRequired !== b.isRequired) return a.isRequired ? -1 : 1;
      return b.minYears - a.minYears;
    })
    .slice(0, 6);
}
