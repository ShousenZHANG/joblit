import type { ExperienceOperator, YearExpression } from "./types";

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
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
};

const WORD =
  "(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|sixty|one|two|three|four|five|six|seven|eight|nine|ten)";
const NUMBER = `(?:[0-9]{1,2}(?:\\.[0-9])?|${WORD})`;
const YEARS = "(?:years?|yrs?\\.?|yr\\.?|y)";
const MONTHS = "(?:months?|mos?\\.?|mo\\.?|mth?s?\\.?|m)";

type Pattern = {
  operator: ExperienceOperator;
  regex: RegExp;
  unit?: "MONTHS";
  compound?: true;
  ambiguous?: true;
};

function pattern(source: string): RegExp {
  return new RegExp(source, "giu");
}

function numberValue(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.toLocaleLowerCase("en").replace(/-/g, " ").trim();
  const words = normalized.split(/\s+/);
  const parsed =
    WORD_NUMERALS[normalized] ??
    (words.length === 2
      ? (WORD_NUMERALS[words[0] ?? ""] ?? 0) +
        (WORD_NUMERALS[words[1] ?? ""] ?? 0)
      : Number(normalized));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 60 ? parsed : null;
}

const PATTERNS: readonly Pattern[] = [
  // Ambiguous ranges are retained as REVIEW evidence, never silently widened.
  {
    operator: "RANGE",
    ambiguous: true,
    regex: pattern(
      `\\b(?<first>${NUMBER})\\s*(?:-|\\u2013|\\u2014|to)\\s*(?<second>${NUMBER})\\s*\\+\\s*${YEARS}\\b`,
    ),
  },
  {
    operator: "RANGE",
    ambiguous: true,
    regex: pattern(
      `\\b(?<first>${NUMBER})\\s+or\\s+(?<second>${NUMBER})\\s*${YEARS}\\b`,
    ),
  },
  // Repeated-unit ranges must precede the generic range.
  {
    operator: "RANGE",
    regex: pattern(
      `\\b(?<first>${NUMBER})\\s*${YEARS}\\s*(?:-|\\u2013|\\u2014|to)\\s*(?<second>${NUMBER})\\s*${YEARS}\\b`,
    ),
  },
  {
    operator: "RANGE",
    unit: "MONTHS",
    regex: pattern(
      `\\b(?<first>${NUMBER})\\s*${MONTHS}\\s*(?:-|\\u2013|\\u2014|to)\\s*(?<second>${NUMBER})\\s*${MONTHS}\\b`,
    ),
  },
  {
    operator: "AT_LEAST",
    compound: true,
    regex: pattern(
      `\\b(?:at\\s+least|minimum(?:\\s+of)?|(?:no|not)\\s+(?:fewer|less)\\s+than)\\s+(?<first>${NUMBER})\\s*${YEARS}\\s*(?:and\\s*)?(?<second>${NUMBER})\\s*${MONTHS}\\b`,
    ),
  },
  {
    operator: "MORE_THAN",
    compound: true,
    regex: pattern(
      `\\b(?:more\\s+than|over)\\s+(?<first>${NUMBER})\\s*${YEARS}\\s*(?:and\\s*)?(?<second>${NUMBER})\\s*${MONTHS}\\b`,
    ),
  },
  {
    operator: "AT_MOST",
    compound: true,
    regex: pattern(
      `\\b(?:at\\s+most|up\\s+to|no\\s+more\\s+than)\\s+(?<first>${NUMBER})\\s*${YEARS}\\s*(?:and\\s*)?(?<second>${NUMBER})\\s*${MONTHS}\\b`,
    ),
  },
  {
    operator: "LESS_THAN",
    compound: true,
    regex: pattern(
      `\\b(?:less\\s+than|under)\\s+(?<first>${NUMBER})\\s*${YEARS}\\s*(?:and\\s*)?(?<second>${NUMBER})\\s*${MONTHS}\\b`,
    ),
  },
  // 1 year 6 months, 1y6m and 1 yr and 6 mos are one exact quantity.
  {
    operator: "EXACT",
    compound: true,
    regex: pattern(
      `\\b(?<first>${NUMBER})\\s*${YEARS}\\s*(?:and\\s*)?(?<second>${NUMBER})\\s*${MONTHS}\\b`,
    ),
  },
  {
    operator: "RANGE",
    unit: "MONTHS",
    regex: pattern(
      `\\b(?<first>${NUMBER})\\s*(?:-|\\u2013|\\u2014|to)\\s*(?<second>${NUMBER})\\s*${MONTHS}\\b`,
    ),
  },
  {
    operator: "RANGE",
    regex: pattern(
      `\\bbetween\\s+(?<first>${NUMBER})\\s+and\\s+(?<second>${NUMBER})\\s*${YEARS}\\b`,
    ),
  },
  {
    operator: "RANGE",
    regex: pattern(
      `\\b(?<first>${NUMBER})\\s*(?:-|\\u2013|\\u2014|to)\\s*(?<second>${NUMBER})\\s*${YEARS}\\b`,
    ),
  },
  // Strict and inclusive comparisons are separate v3 operators.
  ...comparisonPatterns("MONTHS"),
  ...comparisonPatterns("YEARS"),
  {
    operator: "EXACT",
    unit: "MONTHS",
    regex: pattern(`\\b(?<first>${NUMBER})\\s*${MONTHS}\\b`),
  },
  {
    operator: "EXACT",
    regex: pattern(
      `\\b(?<word>${WORD})\\s*\\(\\s*(?<first>[0-9]{1,2}(?:\\.[0-9])?)\\s*\\)\\s*${YEARS}\\b`,
    ),
  },
  {
    operator: "EXACT",
    ambiguous: true,
    regex: pattern(
      `\\b(?:about|around|approximately|roughly|nearly|almost)\\s+(?<first>${NUMBER})\\s*${YEARS}\\b`,
    ),
  },
  {
    operator: "EXACT",
    regex: pattern(`\\b(?<first>${NUMBER})\\s*-\\s*${YEARS}\\b`),
  },
  {
    operator: "EXACT",
    regex: pattern(`\\b(?<first>${NUMBER})\\s*${YEARS}\\b`),
  },
];

function comparisonPatterns(unit: "YEARS" | "MONTHS"): Pattern[] {
  const token = unit === "YEARS" ? YEARS : MONTHS;
  const unitFlag = unit === "MONTHS" ? ({ unit: "MONTHS" } as const) : {};
  return [
    {
      ...unitFlag,
      operator: "AT_LEAST",
      regex: pattern(
        `\\b(?:at\\s+least|minimum(?:\\s+of)?|(?:no|not)\\s+(?:fewer|less)\\s+than)\\s+(?<word>${WORD})\\s*\\(\\s*(?<first>[0-9]{1,2}(?:\\.[0-9])?)\\s*\\)\\s*${token}\\b`,
      ),
    },
    {
      ...unitFlag,
      operator: "AT_LEAST",
      regex: pattern(`(?:>=|\\u2265)\\s*(?<first>${NUMBER})\\s*${token}\\b`),
    },
    {
      ...unitFlag,
      operator: "AT_MOST",
      regex: pattern(`(?:<=|\\u2264)\\s*(?<first>${NUMBER})\\s*${token}\\b`),
    },
    {
      ...unitFlag,
      operator: "MORE_THAN",
      regex: pattern(`(?:>|\\u003e)\\s*(?<first>${NUMBER})\\s*${token}\\b`),
    },
    {
      ...unitFlag,
      operator: "LESS_THAN",
      regex: pattern(`(?:<|\\u003c)\\s*(?<first>${NUMBER})\\s*${token}\\b`),
    },
    {
      ...unitFlag,
      operator: "AT_MOST",
      regex: pattern(
        `\\b(?:up\\s+to|at\\s+most|no\\s+more\\s+than|not\\s+more\\s+than|maximum(?:\\s+of)?)\\s+(?<first>${NUMBER})\\s*${token}\\b`,
      ),
    },
    {
      ...unitFlag,
      operator: "LESS_THAN",
      regex: pattern(
        `\\b(?:less\\s+than|under|fewer\\s+than)\\s+(?<first>${NUMBER})\\s*${token}\\b`,
      ),
    },
    {
      ...unitFlag,
      operator: "AT_LEAST",
      regex: pattern(
        `\\b(?:at\\s+least|minimum(?:\\s+of)?|(?:no|not)\\s+(?:fewer|less)\\s+than)\\s+(?<first>${NUMBER})\\s*\\+?\\s*${token}\\b`,
      ),
    },
    {
      ...unitFlag,
      operator: "MORE_THAN",
      regex: pattern(
        `\\b(?:more\\s+than|over)\\s+(?<first>${NUMBER})\\s*${token}\\b`,
      ),
    },
    {
      ...unitFlag,
      operator: "AT_LEAST",
      regex: pattern(`\\b(?<first>${NUMBER})\\s*${token}\\s*\\+`),
    },
    {
      ...unitFlag,
      operator: "AT_LEAST",
      regex: pattern(`\\b(?<first>${NUMBER})\\s*\\+\\s*${token}\\b`),
    },
    {
      ...unitFlag,
      operator: "AT_LEAST",
      regex: pattern(
        `\\b(?<first>${NUMBER})\\s*${token}(?:['\\u2019]?\\s+(?:of\\s+)?(?:[a-z0-9+#./-]+\\s+){0,7}experience)?\\s+(?:or\\s+more|and\\s+above|minimum|required)\\b`,
      ),
    },
    {
      ...unitFlag,
      operator: "AT_MOST",
      regex: pattern(
        `\\b(?<first>${NUMBER})\\s*${token}(?:\\s+(?:of\\s+)?(?:professional\\s+|commercial\\s+|relevant\\s+)?experience)?\\s+or\\s+less\\b`,
      ),
    },
  ];
}

/** Lex quantifiable duration expressions without assigning job semantics. */
export function findYearExpressions(value: string): YearExpression[] {
  const matches: YearExpression[] = [];
  for (const spec of PATTERNS) {
    for (const match of value.matchAll(spec.regex)) {
      // Do not read the tail of a decimal/version as a fresh number.
      if (/\d\.$/.test(value.slice(0, match.index))) continue;
      const first = numberValue(match.groups?.first);
      const second = numberValue(match.groups?.second);
      const word = numberValue(match.groups?.word);
      if (first === null || (spec.operator === "RANGE" && second === null)) {
        continue;
      }
      const divisor = spec.unit === "MONTHS" ? 12 : 1;
      const compound = spec.compound ? first + (second ?? 0) / 12 : null;
      const firstValue = first / divisor;
      const secondValue = second === null ? null : second / divisor;
      const low = compound ?? Math.min(firstValue, secondValue ?? firstValue);
      const high = compound ?? Math.max(firstValue, secondValue ?? firstValue);
      const upperBound =
        spec.operator === "LESS_THAN" || spec.operator === "AT_MOST";

      matches.push({
        operator: spec.operator,
        min: upperBound ? 0 : low,
        max:
          spec.operator === "MORE_THAN" || spec.operator === "AT_LEAST"
            ? null
            : upperBound
              ? firstValue
              : high,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        ambiguous:
          spec.ambiguous === true ||
          (word !== null && word !== first) ||
          (spec.operator === "RANGE" &&
            secondValue !== null &&
            firstValue > secondValue),
      });
    }
  }

  matches.sort((left, right) =>
    left.start !== right.start
      ? left.start - right.start
      : right.end - left.end,
  );
  const selected: YearExpression[] = [];
  for (const match of matches) {
    if (
      selected.some(
        (other) => match.start < other.end && match.end > other.start,
      )
    ) {
      continue;
    }
    selected.push(match);
  }
  return selected.sort((left, right) => left.start - right.start);
}

/** Parse a unitless ATS field only when its label explicitly supplies years. */
export function findImpliedYearsField(
  value: string,
  minimum: boolean,
): YearExpression[] {
  const match = value.match(/^\s*([0-9]{1,2}(?:\.[0-9])?)\s*(\+)?\s*$/u);
  const number = match?.[1];
  if (!number) return [];
  const parsed = Number(number);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 60) return [];
  const start = match[0].indexOf(number);
  const end = start + number.length + (match[2] ? 1 : 0);
  const lowerBound = minimum || Boolean(match[2]);
  return [
    {
      operator: lowerBound ? "AT_LEAST" : "EXACT",
      min: parsed,
      max: lowerBound ? null : parsed,
      start,
      end,
      text: value.slice(start, end),
      ambiguous: false,
    },
  ];
}
