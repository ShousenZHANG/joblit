import { z } from "zod";

export const ExperienceClassificationSchema = z.enum([
  "REQUIRED",
  "PREFERRED",
  "REVIEW",
]);

export const ExperienceYearsSchema = z
  .object({
    operator: z.enum(["MINIMUM", "RANGE", "MAXIMUM", "EXACT"]),
    min: z.number().int().min(0).max(60),
    max: z.number().int().min(0).max(60).nullable(),
    text: z.string().min(1).max(80),
  })
  .strict()
  .superRefine((years, context) => {
    if (years.max !== null && years.max < years.min) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "max must be greater than or equal to min",
      });
    }
    if (years.operator === "MINIMUM" && years.max !== null) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "minimum requirements cannot have a maximum",
      });
    }
    if (
      (years.operator === "RANGE" ||
        years.operator === "MAXIMUM" ||
        years.operator === "EXACT") &&
      years.max === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: `${years.operator.toLowerCase()} requirements need a maximum`,
      });
    }
    if (years.operator === "MAXIMUM" && years.min !== 0) {
      context.addIssue({
        code: "custom",
        path: ["min"],
        message: "maximum requirements start at zero",
      });
    }
    if (years.operator === "EXACT" && years.max !== years.min) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "exact requirements must have equal bounds",
      });
    }
  });

export const ExperienceEvidenceSchema = z
  .object({
    text: z.string().min(1).max(2_000),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    yearsStart: z.number().int().nonnegative(),
    yearsEnd: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.end < evidence.start) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "evidence end must not precede its start",
      });
    }
    if (
      evidence.yearsStart < evidence.start ||
      evidence.yearsEnd > evidence.end ||
      evidence.yearsEnd < evidence.yearsStart
    ) {
      context.addIssue({
        code: "custom",
        path: ["yearsStart"],
        message: "year offsets must be contained by the evidence span",
      });
    }
  });

export const ExperienceRelationSchema = z
  .object({
    groupId: z.string().min(1).max(160),
    kind: z.enum(["ANY_OF", "ALL_OF"]),
  })
  .strict();

export const JobExperienceRequirementSchema = z
  .object({
    id: z.string().min(1).max(160),
    classification: ExperienceClassificationSchema,
    years: ExperienceYearsSchema,
    scope: z.string().min(1).max(160).nullable(),
    evidence: ExperienceEvidenceSchema,
    relation: ExperienceRelationSchema.optional(),
  })
  .strict()
  .superRefine((requirement, context) => {
    if (
      requirement.evidence.end - requirement.evidence.start !==
      requirement.evidence.text.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence", "text"],
        message: "evidence text length must match its source offsets",
      });
    }
    if (
      requirement.evidence.yearsEnd - requirement.evidence.yearsStart !==
      requirement.years.text.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["years", "text"],
        message: "year text length must match its source offsets",
      });
    }
  });

export const JobExperienceAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["NONE", "FOUND", "REVIEW"]),
    requirements: z.array(JobExperienceRequirementSchema).max(40),
    // Present only when the bounded UI payload omitted additional matches.
    // The status must then be REVIEW so callers cannot mistake a partial
    // analysis for a complete result.
    truncated: z.boolean().optional(),
  })
  .strict()
  .superRefine((analysis, context) => {
    const review = analysis.requirements.some(
      (requirement) => requirement.classification === "REVIEW",
    );
    if (
      analysis.status === "NONE" &&
      (analysis.requirements.length > 0 || analysis.truncated === true)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "NONE cannot contain requirements",
      });
    }
    if (
      analysis.status === "FOUND" &&
      (analysis.requirements.length === 0 ||
        review ||
        analysis.truncated === true)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "FOUND needs only classified requirements",
      });
    }
    if (
      analysis.status === "REVIEW" &&
      !review &&
      analysis.truncated !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "REVIEW needs at least one review requirement",
      });
    }

    const seenIds = new Set<string>();
    const relationGroups = new Map<
      string,
      { count: number; kinds: Set<ExperienceRelation["kind"]> }
    >();
    const orderedOffsets = [...analysis.requirements]
      .map((requirement, index) => ({
        index,
        start: requirement.evidence.yearsStart,
        end: requirement.evidence.yearsEnd,
      }))
      .sort((left, right) => left.start - right.start || left.end - right.end);

    for (const [index, requirement] of analysis.requirements.entries()) {
      if (seenIds.has(requirement.id)) {
        context.addIssue({
          code: "custom",
          path: ["requirements", index, "id"],
          message: "requirement ids must be unique",
        });
      }
      seenIds.add(requirement.id);
      if (requirement.relation) {
        const group = relationGroups.get(requirement.relation.groupId) ?? {
          count: 0,
          kinds: new Set<ExperienceRelation["kind"]>(),
        };
        group.count += 1;
        group.kinds.add(requirement.relation.kind);
        relationGroups.set(requirement.relation.groupId, group);
      }
    }
    for (let index = 1; index < orderedOffsets.length; index += 1) {
      const previous = orderedOffsets[index - 1];
      const current = orderedOffsets[index];
      if (previous && current && current.start < previous.end) {
        context.addIssue({
          code: "custom",
          path: ["requirements", current.index, "evidence", "yearsStart"],
          message: "year evidence offsets must not overlap",
        });
      }
    }
    for (const [groupId, group] of relationGroups) {
      if (group.count < 2 || group.kinds.size !== 1) {
        context.addIssue({
          code: "custom",
          path: ["requirements"],
          message: `relation group ${groupId} must contain at least two members of one kind`,
        });
      }
    }
  });

export type ExperienceClassification = z.infer<
  typeof ExperienceClassificationSchema
>;
export type ExperienceYears = z.infer<typeof ExperienceYearsSchema>;
export type ExperienceEvidence = z.infer<typeof ExperienceEvidenceSchema>;
export type ExperienceRelation = z.infer<typeof ExperienceRelationSchema>;
export type JobExperienceRequirement = z.infer<
  typeof JobExperienceRequirementSchema
>;
export type JobExperienceAnalysis = z.infer<
  typeof JobExperienceAnalysisSchema
>;

export const EMPTY_JOB_EXPERIENCE_ANALYSIS: JobExperienceAnalysis = {
  schemaVersion: 1,
  status: "NONE",
  requirements: [],
};

type HeadingContext = "REQUIRED" | "PREFERRED" | null;

type YearExpression = {
  operator: ExperienceYears["operator"];
  min: number;
  max: number | null;
  start: number;
  end: number;
  text: string;
  ambiguous: boolean;
};

type ContextualYearExpression = {
  expression: YearExpression;
  clauseStart: number;
  clauseEnd: number;
  relation?: ExperienceRelation;
  forceReview: boolean;
};

type DraftRequirement = {
  requirement: JobExperienceRequirement;
  explicitClassification: Exclude<ExperienceClassification, "REVIEW"> | null;
  propagationEligible: boolean;
};

const WORD_NUMERALS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const YEAR_NUMBER_SOURCE =
  "(?:[0-9]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)";
const YEAR_WORD_SOURCE =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten)";

const PREFERRED_QUALIFIER_RE =
  /\b(?:preferred|desirable|desired|ideally|nice[- ]to[- ]have|bonus|optional|a plus|advantageous)\b/giu;
const PREFERRED_SIGNAL_RE =
  /\b(?:preferred|desirable|desired|ideally|nice[- ]to[- ]have|bonus|optional|a plus|advantageous)\b/iu;
const NEGATED_PREFERENCE_RE =
  /\bnot\s+(?:preferred|desirable|desired|advantageous)\b/iu;
const REQUIRED_QUALIFIER_RE =
  /\b(?:required|requires?|must(?:\s+have)?|mandatory|essential|minimum|at\s+least|need(?:ed|s)?|qualification)\b/giu;
const NEGATED_EXPERIENCE_RE =
  /\b(?:do|does|did)\s+not\s+(?:need|require)\b|\b(?:experience|background)\b.{0,50}\bnot\s+(?:required|necessary|essential|mandatory)\b|\bno\b(?!\s+(?:fewer|less|more)\b).{0,80}\b(?:required|necessary|needed|mandatory)\b/iu;
const ORGANISATION_HISTORY_RE = new RegExp(
  `\\b(?:company|business|organisation|organization|firm|team|product|platform|technology)\\b(?:[^.;]{0,45}\\b(?:has|have|brings?)\\s+(?:(?:a|an)\\s+)?(?:combined\\s+)?(?:over\\s+|more\\s+than\\s+)?${YEAR_NUMBER_SOURCE}\\s*years?\\b|[^.;]{0,60}\\b(?:operat(?:e|es|ed|ing)|launch(?:ed|es)?|found(?:ed)?|establish(?:ed)?|serv(?:e|es|ed|ing))\\b)|\\b(?:has|have)\\s+been\\s+(?:in\\s+business|operating)\\b`,
  "iu",
);
const NON_EXPERIENCE_DURATION_RE =
  /\b(?:contract|engagement|assignment|visa|passport|degree|university|college|study|course|training|programme|program|apprenticeship|internship|warranty|licen[cs]e|registration|membership|clearance|certificate|certification|residen(?:ce|cy)|citizenship|work rights?|sponsorship|records?|record[- ]keeping|retention|retain(?:ed|s|ing)?|audit)\b|\byears?\s+(?:old|ago|of\s+service)\b/iu;
const DIRECT_EXPERIENCE_RE =
  /\b(?:years?|yrs?)['\u2019]?\.?\s+(?:of\s+)?(?:[a-z+#./-]+\s+){0,7}(?:experience|exp)\b|\b(?:years?|yrs?)['\u2019]?\.?\s+of\s+.{1,60}?\s+experience\b|\b(?:experience|exp)\b.{0,45}\b(?:years?|yrs?)\b/iu;

function yearNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.toLocaleLowerCase("en");
  const parsed = WORD_NUMERALS[normalized] ?? Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 60
    ? parsed
    : null;
}

function yearPattern(source: string): RegExp {
  return new RegExp(source, "giu");
}

function findYearExpressions(value: string): YearExpression[] {
  const patterns: Array<{
    operator: ExperienceYears["operator"];
    regex: RegExp;
    maximum?: boolean;
    ambiguous?: boolean;
  }> = [
    {
      operator: "EXACT",
      regex: yearPattern(
        `\\b(?<word>${YEAR_WORD_SOURCE})\\s*\\(\\s*(?<first>[0-9]{1,2})\\s*\\)\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "RANGE",
      regex: yearPattern(
        `\\bbetween\\s+(?<first>${YEAR_NUMBER_SOURCE})\\s+and\\s+(?<second>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "RANGE",
      regex: yearPattern(
        `\\b(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:-|\\u2013|\\u2014|to)\\s*(?<second>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "MAXIMUM",
      maximum: true,
      regex: yearPattern(
        `\\b(?:up\\s+to|no\\s+more\\s+than|not\\s+more\\s+than|maximum(?:\\s+of)?)\\s+(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "MAXIMUM",
      maximum: true,
      ambiguous: true,
      regex: yearPattern(
        `\\b(?:less\\s+than|under)\\s+(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "MAXIMUM",
      maximum: true,
      regex: yearPattern(
        `\\b(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)\\b(?:\\s+(?:of\\s+)?(?:professional\\s+|commercial\\s+|relevant\\s+)?experience)?\\s+or\\s+less\\b`,
      ),
    },
    {
      operator: "MINIMUM",
      regex: yearPattern(
        `\\b(?:at\\s+least|minimum(?:\\s+of)?|(?:no|not)\\s+(?:fewer|less)\\s+than)\\s+(?<first>${YEAR_NUMBER_SOURCE})\\s*\\+?\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "MINIMUM",
      ambiguous: true,
      regex: yearPattern(
        `\\b(?:more\\s+than|over)\\s+(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "EXACT",
      ambiguous: true,
      regex: yearPattern(
        `\\b(?:about|around|approximately|roughly|nearly|almost)\\s+(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "MINIMUM",
      regex: yearPattern(
        `\\b(?<first>${YEAR_NUMBER_SOURCE})\\s*\\+\\s*(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "MINIMUM",
      regex: yearPattern(
        `\\b(?<first>${YEAR_NUMBER_SOURCE})\\s+(?:or\\s+more|and\\s+above)\\s+(?:years?|yrs?)\\b`,
      ),
    },
    {
      operator: "MINIMUM",
      regex: yearPattern(
        `\\b(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)(?:['\u2019]?\\s+(?:of\\s+)?(?:[a-z+#./-]+\\s+){0,7}experience)?\\s+(?:or\\s+more|and\\s+above)\\b`,
      ),
    },
    {
      operator: "MINIMUM",
      regex: yearPattern(
        `\\b(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)(?:['\u2019]?\\s+(?:of\\s+)?(?:[a-z+#./-]+\\s+){0,7}experience)?\\s+(?:minimum|required)\\b`,
      ),
    },
    {
      operator: "EXACT",
      regex: yearPattern(
        `\\b(?<first>${YEAR_NUMBER_SOURCE})\\s*(?:years?|yrs?)\\b`,
      ),
    },
  ];

  const matches: YearExpression[] = [];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern.regex)) {
      if (/\d\.$/.test(value.slice(0, match.index))) continue;
      const first = yearNumber(match.groups?.first);
      const second = yearNumber(match.groups?.second);
      const word = yearNumber(match.groups?.word);
      if (first === null || (pattern.operator === "RANGE" && second === null)) {
        continue;
      }
      const low = second === null ? first : Math.min(first, second);
      const high = second === null ? first : Math.max(first, second);
      matches.push({
        operator: pattern.operator,
        min: pattern.maximum ? 0 : low,
        max:
          pattern.operator === "MINIMUM"
            ? null
            : pattern.maximum
              ? first
              : high,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        ambiguous:
          pattern.ambiguous === true ||
          (word !== null && word !== first) ||
          (pattern.operator === "RANGE" && second !== null && first > second),
      });
    }
  }

  matches.sort((left, right) =>
    left.start !== right.start
      ? left.start - right.start
      : right.end - left.end,
  );
  const nonOverlapping: YearExpression[] = [];
  for (const match of matches) {
    if (
      nonOverlapping.some(
        (selected) => match.start < selected.end && match.end > selected.start,
      )
    ) {
      continue;
    }
    nonOverlapping.push(match);
  }
  return nonOverlapping.sort((left, right) => left.start - right.start);
}

function nearestQualifierDistance(
  value: string,
  regex: RegExp,
  expression: YearExpression,
): number | null {
  const expressionCenter = (expression.start + expression.end) / 2;
  let nearest: number | null = null;
  for (const match of value.matchAll(regex)) {
    const center = match.index + match[0].length / 2;
    const distance = Math.abs(center - expressionCenter);
    nearest = nearest === null ? distance : Math.min(nearest, distance);
  }
  return nearest;
}

function classifyExpression(
  evidence: string,
  expression: YearExpression,
  context: HeadingContext,
): ExperienceClassification {
  if (expression.ambiguous || !hasCandidateExperienceContext(evidence, expression)) {
    return "REVIEW";
  }
  const explicit = explicitQualifierClassification(evidence, expression);
  if (explicit) return explicit;
  if (context) return context;
  return "REVIEW";
}

function explicitQualifierClassification(
  evidence: string,
  expression: YearExpression,
): Exclude<ExperienceClassification, "REVIEW"> | null {
  const preferredDistance = nearestQualifierDistance(
    evidence,
    PREFERRED_QUALIFIER_RE,
    expression,
  );
  const requiredDistance = nearestQualifierDistance(
    evidence,
    REQUIRED_QUALIFIER_RE,
    expression,
  );
  if (preferredDistance !== null || requiredDistance !== null) {
    if (preferredDistance === null) return "REQUIRED";
    if (requiredDistance === null) return "PREFERRED";
    return preferredDistance <= requiredDistance ? "PREFERRED" : "REQUIRED";
  }
  return null;
}

function hasCandidateExperienceContext(
  evidence: string,
  expression: YearExpression,
): boolean {
  const vicinity = evidence.slice(
    Math.max(0, expression.start - 80),
    Math.min(evidence.length, expression.end + 100),
  );
  if (DIRECT_EXPERIENCE_RE.test(vicinity)) return true;
  const tail = evidence.slice(expression.end);
  if (
    /^['\u2019]?\s+(?:in|with|using|on|as|working\s+(?:in|with|as))\b/iu.test(
      tail,
    )
  ) {
    return true;
  }
  if (bareScopeForExpression(evidence, expression)) return true;
  const prefix = evidence.slice(0, expression.start);
  return /\b(?:applicants?|candidates?|you|we\s+(?:seek|need|require)|successful\s+applicant)\b.{0,70}$/iu.test(
    prefix,
  );
}

function shouldIgnoreExpression(
  evidence: string,
  expression: YearExpression,
): boolean {
  const localEvidence = localClauseForExpression(evidence, expression);
  const localExpression = {
    ...expression,
    start: expression.start - localEvidence.start,
    end: expression.end - localEvidence.start,
  };
  if (NEGATED_PREFERENCE_RE.test(localEvidence.text)) return true;
  if (
    NEGATED_EXPERIENCE_RE.test(localEvidence.text) &&
    !PREFERRED_SIGNAL_RE.test(localEvidence.text)
  ) {
    return true;
  }
  if (ORGANISATION_HISTORY_RE.test(localEvidence.text)) return true;
  if (!NON_EXPERIENCE_DURATION_RE.test(localEvidence.text)) return false;
  const vicinity = localEvidence.text.slice(
    Math.max(0, localExpression.start - 24),
    Math.min(localEvidence.text.length, localExpression.end + 90),
  );
  return !DIRECT_EXPERIENCE_RE.test(vicinity);
}

function localClauseForExpression(
  evidence: string,
  expression: YearExpression,
): { text: string; start: number } {
  const boundaries = [
    ...evidence.matchAll(/(?:,\s*|\s+)(?:and|but|however|while|whereas)\s+/giu),
  ].filter(
    (boundary) =>
      boundary.index + boundary[0].length <= expression.start ||
      boundary.index >= expression.end,
  );
  const before = boundaries
    .filter((boundary) => boundary.index + boundary[0].length <= expression.start)
    .at(-1);
  const after = boundaries.find((boundary) => boundary.index >= expression.end);
  const start = before ? before.index + before[0].length : 0;
  const end = after?.index ?? evidence.length;
  return { text: evidence.slice(start, end), start };
}

function relationConnector(
  value: string,
  start: number,
  end: number,
): { start: number; end: number; kind: ExperienceRelation["kind"] } | null {
  const between = value.slice(start, end);
  const connectors = [
    ...between.matchAll(/\b(and|or|plus)\b/giu),
  ];
  const connector = connectors.at(-1);
  if (!connector) return null;
  return {
    start: start + connector.index,
    end: start + connector.index + connector[0].length,
    kind: connector[1]?.toLocaleLowerCase("en") === "or" ? "ANY_OF" : "ALL_OF",
  };
}

function contextualizeExpressions(
  evidence: string,
  evidenceStart: number,
  expressions: YearExpression[],
): ContextualYearExpression[] {
  if (expressions.length < 2) {
    return expressions.map((expression) => ({
      expression,
      clauseStart: 0,
      clauseEnd: evidence.length,
      forceReview: false,
    }));
  }
  const connectors = expressions.slice(0, -1).map((expression, index) =>
    relationConnector(
      evidence,
      expression.end,
      expressions[index + 1]?.start ?? expression.end,
    ),
  );
  const relationKind = connectors[0]?.kind;
  const connectorCount = connectors.filter(Boolean).length;
  const unsafeSyntax =
    /\band\s*\/\s*or\b|\b(?:if|unless|provided(?:\s+that)?|depending(?:\s+on)?)\b/iu.test(
      evidence,
    );
  const unsafeGroup =
    unsafeSyntax ||
    (connectorCount > 0 &&
      (connectorCount !== connectors.length ||
        !connectors.every((connector) => connector?.kind === relationKind)));
  const oneRelation =
    !unsafeGroup &&
    relationKind &&
    connectors.every((connector) => connector?.kind === relationKind)
      ? relationKind
      : null;
  const relation: ExperienceRelation | undefined = oneRelation
    ? {
        groupId: `experience-group-${evidenceStart}-${evidenceStart + evidence.length}-${oneRelation.toLocaleLowerCase("en")}`,
        kind: oneRelation,
      }
    : undefined;

  return expressions.map((expression, index) => ({
    expression,
    clauseStart: connectors[index - 1]?.end ?? 0,
    clauseEnd: connectors[index]?.start ?? evidence.length,
    ...(relation ? { relation } : {}),
    forceReview: unsafeGroup,
  }));
}

function headingContext(value: string): HeadingContext | undefined {
  if (
    /^(?:(?:required|minimum|essential) (?:qualifications?|requirements?|experience)|requirements?|qualifications?|experience|your (?:experience|background)|must[- ]haves?|skills? and experience|selection criteria|what you(?:'ll| will) bring|what we(?:'re| are) looking for|about you|who you are):?$/i.test(
      value,
    )
  ) {
    return "REQUIRED";
  }
  if (
    /^(?:(?:preferred|desirable) (?:qualifications?|skills?|experience)|preferred|desirable|nice[- ]to[- ]haves?|bonus points?|good to have):?$/i.test(
      value,
    )
  ) {
    return "PREFERRED";
  }
  if (
    /^(?:about(?:\s+us|\s+the\s+(?:company|team|role))?|benefits?|perks?|what\s+we\s+offer|why\s+join\s+us|culture|company|our\s+(?:company|team)|salary|remuneration|employment\s+details?|the\s+role|role\s+overview|responsibilities|key\s+responsibilities|what\s+you(?:'ll|\s+will)\s+do|day[- ]to[- ]day|key\s+accountabilities|duties|application\s+process|equal\s+opportunity|diversity):?$/i.test(
      value,
    )
  ) {
    return null;
  }
  return undefined;
}

function inlineHeading(value: string): {
  context: HeadingContext;
  remainder: string;
  remainderStart: number;
} | null {
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const parsedContext = headingContext(value.slice(0, separator));
  if (parsedContext === undefined) return null;
  const rawRemainder = value.slice(separator + 1);
  const remainder = rawRemainder.trimStart();
  return {
    context: parsedContext,
    remainder,
    remainderStart:
      separator + 1 + (rawRemainder.length - remainder.length),
  };
}

function boundedEvidence(
  description: string,
  start: number,
  end: number,
  yearsStart: number,
  yearsEnd: number,
): ExperienceEvidence {
  const maximumLength = 2_000;
  let boundedStart = start;
  let boundedEnd = end;
  if (end - start > maximumLength) {
    boundedStart = Math.max(start, yearsStart - 900);
    boundedEnd = Math.min(end, boundedStart + maximumLength);
    if (boundedEnd < yearsEnd) {
      boundedEnd = yearsEnd;
      boundedStart = Math.max(start, boundedEnd - maximumLength);
    }
  }
  return {
    text: description.slice(boundedStart, boundedEnd),
    start: boundedStart,
    end: boundedEnd,
    yearsStart,
    yearsEnd,
  };
}

function contentSpan(
  description: string,
  lineStart: number,
  rawLine: string,
): { text: string; start: number; end: number } | null {
  const leading =
    rawLine.match(/^\s*(?:#{1,6}\s+)?(?:[-+*\u2022>]\s*)?/)?.[0].length ??
    0;
  const withoutPrefix = rawLine.slice(leading);
  const text = withoutPrefix.trimEnd();
  if (!text) return null;
  const start = lineStart + leading;
  const end = start + text.length;
  return { text, start, end };
}

function buildOffsetPreservingScanText(description: string): string {
  return description
    .replace(/<[^>]+>/g, (tag) => {
      const blockBoundary =
        /^<\/?(?:address|article|aside|blockquote|br|div|h[1-6]|header|li|main|ol|p|section|table|tr|ul)\b/i.test(
          tag,
        );
      return blockBoundary
        ? `\n${" ".repeat(Math.max(0, tag.length - 1))}`
        : " ".repeat(tag.length);
    })
    .replace(/[*_`~]/g, " ");
}

function evidenceSpans(value: string): Array<{
  text: string;
  start: number;
}> {
  const spans: Array<{ text: string; start: number }> = [];
  let start = 0;
  const push = (end: number) => {
    const raw = value.slice(start, end);
    const text = raw.trim();
    if (text) spans.push({ text, start: start + raw.indexOf(text) });
  };
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const decimalPoint =
      character === "." &&
      /\d/.test(value[index - 1] ?? "") &&
      /\d/.test(value[index + 1] ?? "");
    const yearAbbreviation =
      character === "." &&
      /\b(?:yr|yrs)$/i.test(value.slice(0, index)) &&
      /^\s+(?:of\s+)?(?:experience|exp)\b/i.test(value.slice(index + 1));
    if (
      character !== ";" &&
      (character !== "." || decimalPoint || yearAbbreviation)
    ) {
      continue;
    }
    push(index);
    start = index + 1;
  }
  push(value.length);
  return spans;
}

function cleanScope(value: string | undefined): string | null {
  const scope = (value ?? "")
    .replace(
      /\s+(?:is\s+|are\s+)?(?:required|preferred|mandatory|essential|desired)\b.*$/i,
      "",
    )
    .trim()
    .replace(/^[,:\-\s]+|[,:\-\s]+$/g, "")
    .replace(/\s+/g, " ");
  if (!scope || scope.length > 160 || scope.split(/\s+/).length > 14) {
    return null;
  }
  if (
    /^(?:(?:of\s+)?experience|professional|commercial|relevant|hands-on|industry|general|overall|work|total|duration|term|period|is|are|was|were|has|have|required|preferred)$/i.test(
      scope,
    )
  ) {
    return null;
  }
  return scope;
}

function bareScopeForExpression(
  clause: string,
  expression: YearExpression,
): string | null {
  const tail = clause
    .slice(expression.end)
    .replace(
      /\b(?:if|unless|provided(?:\s+that)?|depending(?:\s+on)?)\b.*$/iu,
      "",
    );
  const match = tail.match(
    /^['\u2019]?\s+([A-Za-z0-9.+#/-]+(?:\s+[A-Za-z0-9.+#/-]+){0,5})(?:\s+(?:is\s+)?(?:required|preferred|mandatory|essential|desired))?\s*$/iu,
  );
  if (!match) return null;
  const scope = cleanScope(match[1]);
  if (
    scope &&
    !/^(?:for|during|until|within|after|before|per|throughout)\b/iu.test(scope) &&
    !/^(?:ago|old|service|contract|visa|degree|course|training|programme|program)$/iu.test(
      scope,
    )
  ) {
    return scope;
  }
  return null;
}

function scopeForExpression(
  clause: string,
  expression: YearExpression,
): string | null {
  const tail = clause
    .slice(expression.end)
    .replace(/^['\u2019]?[.\s]*/, "");
  const genericExperience = tail.match(
    /^(?:of\s+)?(?:(?:professional|commercial|relevant|hands-on|industry)\s+)?experience\s+(?:in|with|using|on)\s+(.+)$/i,
  );
  if (genericExperience) return cleanScope(genericExperience[1]);
  const scopedExperience = tail.match(/^of\s+(.+?)\s+experience\b/i);
  if (scopedExperience) return cleanScope(scopedExperience[1]);
  const directScope = tail.match(/^(?:in|with|using|on)\s+(.+)$/i);
  if (directScope) return cleanScope(directScope[1]);
  const bareScope = bareScopeForExpression(clause, expression);
  if (bareScope) return bareScope;

  const prefix = clause.slice(0, expression.start);
  const prefixExperience = prefix.match(
    /([A-Za-z0-9][A-Za-z0-9+#./ -]{0,120}?)\s+experience\s*:?\s*$/i,
  );
  return cleanScope(prefixExperience?.[1]);
}

/** Analyze role-experience requirements in one job description. */
export function analyzeJobExperience(
  description: string | null | undefined,
): JobExperienceAnalysis {
  if (!description?.trim()) return EMPTY_JOB_EXPERIENCE_ANALYSIS;
  const requirements: JobExperienceRequirement[] = [];
  let context: HeadingContext = null;
  const scanText = buildOffsetPreservingScanText(description);

  for (const lineMatch of scanText.matchAll(/[^\r\n]+/g)) {
    const lineStart = lineMatch.index;
    let content = contentSpan(scanText, lineStart, lineMatch[0]);
    if (!content) continue;
    const heading = headingContext(content.text);
    if (heading !== undefined) {
      context = heading;
      continue;
    }
    const headingWithContent = inlineHeading(content.text);
    if (headingWithContent) {
      context = headingWithContent.context;
      if (!headingWithContent.remainder) continue;
      content = {
        text: headingWithContent.remainder,
        start: content.start + headingWithContent.remainderStart,
        end: content.end,
      };
    }

    for (const evidenceSpan of evidenceSpans(content.text)) {
      const trimmed = evidenceSpan.text;
      const evidenceStart = content.start + evidenceSpan.start;
      const evidenceEnd = evidenceStart + trimmed.length;
      const expressions = findYearExpressions(trimmed).filter(
        (expression) => !shouldIgnoreExpression(trimmed, expression),
      );
      const contextualExpressions = contextualizeExpressions(
        trimmed,
        evidenceStart,
        expressions,
      );
      const drafts: DraftRequirement[] = [];
      for (const contextual of contextualExpressions) {
        const { expression } = contextual;
        const clause = trimmed.slice(
          contextual.clauseStart,
          contextual.clauseEnd,
        );
        const localExpression = {
          ...expression,
          start: expression.start - contextual.clauseStart,
          end: expression.end - contextual.clauseStart,
        };
        const hasCandidateContext = hasCandidateExperienceContext(
          clause,
          localExpression,
        );
        if (!hasCandidateContext && context === null) continue;
        const explicitClassification = explicitQualifierClassification(
          clause,
          localExpression,
        );
        const yearsStart = evidenceStart + expression.start;
        const yearsEnd = evidenceStart + expression.end;
        const classification = contextual.forceReview
          ? "REVIEW"
          : classifyExpression(clause, localExpression, context);
        drafts.push({
          requirement: {
            id: `experience-${yearsStart}-${yearsEnd}`,
            classification,
            years: {
              operator: expression.operator,
              min: expression.min,
              max: expression.max,
              text: description.slice(yearsStart, yearsEnd),
            },
            scope: scopeForExpression(clause, localExpression),
            evidence: boundedEvidence(
              description,
              evidenceStart,
              evidenceEnd,
              yearsStart,
              yearsEnd,
            ),
            ...(contextual.relation ? { relation: contextual.relation } : {}),
          },
          explicitClassification,
          propagationEligible:
            !contextual.forceReview &&
            !expression.ambiguous &&
            hasCandidateContext &&
            explicitClassification === null &&
            context === null &&
            classification === "REVIEW",
        });
      }

      const relationGroupId = drafts[0]?.requirement.relation?.groupId;
      const completeRelationGroup =
        drafts.length > 1 &&
        relationGroupId !== undefined &&
        drafts.every(
          (draft) => draft.requirement.relation?.groupId === relationGroupId,
        );
      if (!completeRelationGroup) {
        for (const draft of drafts) delete draft.requirement.relation;
      } else {
        const qualifierSources = drafts.filter(
          (draft) =>
            draft.explicitClassification !== null &&
            draft.requirement.classification !== "REVIEW",
        );
        if (qualifierSources.length === 1) {
          const propagated = qualifierSources[0]?.explicitClassification;
          if (propagated) {
            for (const draft of drafts) {
              if (draft.propagationEligible) {
                draft.requirement.classification = propagated;
              }
            }
          }
        }
      }
      requirements.push(...drafts.map((draft) => draft.requirement));
    }
  }

  const uniqueRequirements = [
    ...new Map(requirements.map((requirement) => [requirement.id, requirement])).values(),
  ];
  const truncated = uniqueRequirements.length > 40;
  let cappedRequirements = uniqueRequirements.slice(0, 40);
  if (truncated) {
    const completeGroupSizes = new Map<string, number>();
    const includedGroupSizes = new Map<string, number>();
    for (const requirement of uniqueRequirements) {
      const groupId = requirement.relation?.groupId;
      if (!groupId) continue;
      completeGroupSizes.set(groupId, (completeGroupSizes.get(groupId) ?? 0) + 1);
    }
    for (const requirement of cappedRequirements) {
      const groupId = requirement.relation?.groupId;
      if (!groupId) continue;
      includedGroupSizes.set(groupId, (includedGroupSizes.get(groupId) ?? 0) + 1);
    }
    const incompleteGroups = new Set(
      [...includedGroupSizes].flatMap(([groupId, count]) =>
        count === completeGroupSizes.get(groupId) ? [] : [groupId],
      ),
    );
    cappedRequirements = cappedRequirements.filter(
      (requirement) =>
        !requirement.relation ||
        !incompleteGroups.has(requirement.relation.groupId),
    );
  }
  const needsReview = cappedRequirements.some(
    (requirement) => requirement.classification === "REVIEW",
  );
  return JobExperienceAnalysisSchema.parse({
    schemaVersion: 1,
    status:
      truncated
        ? "REVIEW"
        : cappedRequirements.length === 0
          ? "NONE"
          : needsReview
            ? "REVIEW"
            : "FOUND",
    requirements: cappedRequirements,
    ...(truncated ? { truncated: true } : {}),
  });
}
