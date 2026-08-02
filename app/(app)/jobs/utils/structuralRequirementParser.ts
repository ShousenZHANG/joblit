export type StructuralRequirementSignal = {
  key: string;
  /** Prefixed for the few flat-list callers that do not group by strength. */
  label: string;
  /** Constraint-only label for callers with Required/Preferred headings. */
  shortLabel: string;
  evidence: string;
  isRequired: boolean;
};

const SOFT_RE =
  /\b(preferred|nice to have|nice-to-have|bonus|desired|desirable|optional|a plus|ideally|advantageous)\b/i;
const HARD_RE =
  /\b(require|requires|required|requirements|qualification|qualifications|minimum|at least|must|essential|mandatory)\b/i;
const NEGATED_REQUIREMENT_RE =
  /\b(?:is|are|was|were)?\s*not\s+(?:\w+\s+){0,4}(?:required|necessary|essential|mandatory)\b|\bno\s+(?:prior\s+)?(?:\w+\s+){0,4}(?:is\s+)?required\b|\bwe do not require\b/i;
const DEGREE_RE =
  /\b(bachelor'?s?|master'?s?|phd|doctorate|degree|bs|ms|b\.s\.|m\.s\.|computer science|information technology|related field|tertiary|university)\b/i;
const CLEARANCE_RE =
  /\b(security clearance|top secret|ts\/sci|secret clearance|clearance required|public trust|baseline clearance|nv1|nv2|negative vetting)\b/i;
const CITIZENSHIP_RE =
  /\b(citizen(ship)?|permanent resident|pr holder|work rights|authorized to work|visa sponsor|no sponsor|right to work|unrestricted work)\b/i;
const SPONSORSHIP_OFFERED_RE =
  /\b(visa sponsorship (?:is )?(?:available|offered|provided)|we (?:can |do )?sponsor|sponsorship support)\b/i;
const LOCATION_MODE_RE =
  /\b(fully remote|remote[- ]first|hybrid|on[- ]?site|in[- ]?office|work from home|wfh)\b/i;

/**
 * Extract non-year structural requirements shown alongside the fit evidence.
 * Candidate experience has its own evidence-preserving deep module; keeping it
 * out of this parser prevents a year count from appearing as a destructive
 * screening gate before the candidate has run a Fit scan.
 */
export function parseStructuralRequirements(
  description: string,
): StructuralRequirementSignal[] {
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
  const output: StructuralRequirementSignal[] = [];
  const seen = new Set<string>();

  const emit = (label: string, segment: string, isRequired: boolean) => {
    const key = `${label.toLowerCase()}|${isRequired ? "required" : "preferred"}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push({
      key,
      label: `${isRequired ? "Required" : "Preferred"}: ${label}`,
      shortLabel: label,
      evidence: segment,
      isRequired,
    });
  };

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (!DEGREE_RE.test(lower)) continue;
    const hard = HARD_RE.test(lower);
    const soft = SOFT_RE.test(lower);
    const degreeMatch = lower.match(/\b(bachelor|master|phd|doctorate)\b/i);
    const label = degreeMatch
      ? `${degreeMatch[1].charAt(0).toUpperCase()}${degreeMatch[1].slice(1)}'s degree`
      : "Degree required";
    const hasEquivalentAlternative =
      /\bor equivalent (?:experience|qualification)\b/i.test(segment);
    emit(
      hasEquivalentAlternative ? `${label} or equivalent experience` : label,
      segment,
      hard && !soft && !hasEquivalentAlternative,
    );
    break;
  }

  for (const segment of segments) {
    if (!CLEARANCE_RE.test(segment)) continue;
    if (NEGATED_REQUIREMENT_RE.test(segment)) continue;
    emit("Security clearance", segment, !SOFT_RE.test(segment));
    break;
  }

  for (const segment of segments) {
    if (!CITIZENSHIP_RE.test(segment)) continue;
    if (NEGATED_REQUIREMENT_RE.test(segment)) continue;
    if (SPONSORSHIP_OFFERED_RE.test(segment)) continue;
    const noSponsor = /\bno\s*sponsor|without\s*sponsor/i.test(segment);
    emit(
      noSponsor ? "No visa sponsorship" : "Work rights required",
      segment,
      !SOFT_RE.test(segment),
    );
    break;
  }

  for (const segment of segments) {
    const match = segment.match(LOCATION_MODE_RE);
    if (!match) continue;
    const mode = match[0].trim();
    const soft = SOFT_RE.test(segment);
    const hard = HARD_RE.test(segment);
    emit(
      mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase(),
      segment,
      hard && !soft,
    );
    break;
  }

  return output
    .sort((a, b) => Number(b.isRequired) - Number(a.isRequired))
    .slice(0, 6);
}
