import type { EvidenceSpan, HeadingContext } from "./types";

const REQUIRED_HEADINGS =
  /^(?:(?:required|minimum|essential)\s+(?:qualifications?|requirements?|skills?(?:\s*(?:&|and)\s*(?:experience|qualifications?))?|experience(?:\s*(?:&|and)\s*skills?)?)|(?:key|job)\s+requirements?|requirements?|qualifications?|experience|your\s+(?:experience|background|skills?(?:\s*(?:&|and)\s*experience)?)|must[- ]haves?|skills?\s*(?:&|and)\s*(?:experience|qualifications?)|experience\s*(?:&|and)\s*(?:skills?|qualifications?)|selection\s+criteria|what\s+you(?:'ll|\s+will)\s+bring|what\s+we(?:'re|\s+are)\s+looking\s+for|about\s+you|who\s+you\s+are):?$/iu;
const PREFERRED_HEADINGS =
  /^(?:(?:preferred|desirable)\s+(?:qualifications?(?:\s*(?:&|and)\s*experience)?|skills?(?:\s*(?:&|and)\s*(?:experience|qualifications?))?|experience(?:\s*(?:&|and)\s*skills?)?)|preferred|desirable|nice[- ]to[- ]haves?|bonus\s+points?|good\s+to\s+have):?$/iu;
const NON_REQUIREMENT_HEADINGS =
  /^(?:about(?:\s+us|\s+the\s+(?:company|team|role))?|benefits?|perks?|what\s+we\s+offer|why\s+join\s+us|culture|company|our\s+(?:company|team)|salary|remuneration|employment\s+details?|the\s+role|role\s+overview|responsibilities|key\s+responsibilities|what\s+you(?:'ll|\s+will)\s+do|day[- ]to[- ]day|key\s+accountabilities|duties|application\s+process|equal\s+opportunity|diversity):?$/iu;

export function headingContext(value: string): HeadingContext | undefined {
  const normalized = value
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (REQUIRED_HEADINGS.test(normalized)) return "REQUIRED";
  if (PREFERRED_HEADINGS.test(normalized)) return "PREFERRED";
  if (NON_REQUIREMENT_HEADINGS.test(normalized)) return null;
  return undefined;
}

function inlineHeading(value: string): {
  context: HeadingContext;
  remainder: string;
  remainderStart: number;
  candidateLabel: boolean;
  minimumLabel: boolean;
} | null {
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const label = value.slice(0, separator);
  const field = experienceFieldLabel(label);
  const parsed =
    headingContext(label) ?? (field.candidate ? "REQUIRED" : undefined);
  if (parsed === undefined) return null;
  const raw = value.slice(separator + 1);
  const remainder = raw.trimStart();
  return {
    context: parsed,
    remainder,
    remainderStart: separator + 1 + raw.length - remainder.length,
    candidateLabel: field.candidate,
    minimumLabel: field.minimum,
  };
}

function experienceFieldLabel(value: string): {
  candidate: boolean;
  minimum: boolean;
} {
  const normalized = value
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:$/, "");
  const candidate =
    /^(?:(?:minimum\s+)?(?:overall\s+)?experience(?:\s*\(\s*years?\s*\))?|minimum\s+experience\s+years?)$/iu.test(
      normalized,
    );
  return { candidate, minimum: candidate && /^minimum\b/iu.test(normalized) };
}

function unknownInlineHeading(value: string): {
  remainder: string;
  remainderStart: number;
} | null {
  const separator = value.indexOf(":");
  if (separator < 1 || separator > 80) return null;
  const label = value.slice(0, separator).trim();
  if (
    !label ||
    label.split(/\s+/).length > 10 ||
    /\d|[.!?;]/u.test(label) ||
    /^https?$/iu.test(label) ||
    /^experience\s+(?:in|within|across|with|using|on)\s+.+$/iu.test(label)
  ) {
    return null;
  }
  const raw = value.slice(separator + 1);
  const remainder = raw.trimStart();
  return {
    remainder,
    remainderStart: separator + 1 + raw.length - remainder.length,
  };
}

function offsetPreservingScanText(description: string): string {
  return description
    .replace(/<[^>]+>/g, (tag) => {
      const block =
        /^<\/?(?:address|article|aside|blockquote|br|div|h[1-6]|header|li|main|ol|p|section|table|tr|ul)\b/iu.test(
          tag,
        );
      return block
        ? `\n${" ".repeat(Math.max(0, tag.length - 1))}`
        : " ".repeat(tag.length);
    })
    .replace(/[*_`~]/g, " ");
}

function htmlHeadingRanges(
  description: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of description.matchAll(
    /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]\s*>/giu,
  )) {
    const openingEnd = match[0].indexOf(">") + 1;
    const closingStart = match[0].toLocaleLowerCase("en").lastIndexOf("</h");
    if (openingEnd > 0 && closingStart >= openingEnd) {
      ranges.push({
        start: match.index + openingEnd,
        end: match.index + closingStart,
      });
    }
  }
  return ranges;
}

function lineContent(
  lineStart: number,
  rawLine: string,
): { text: string; start: number; end: number } | null {
  const leading =
    rawLine.match(/^\s*(?:#{1,6}\s+)?(?:[-+*\u2022]\s+|>\s+)?/)?.[0].length ??
    0;
  const withoutPrefix = rawLine.slice(leading);
  const text = withoutPrefix.trimEnd();
  if (!text) return null;
  const start = lineStart + leading;
  return { text, start, end: start + text.length };
}

function sentenceSpans(value: string): Array<{ text: string; start: number }> {
  const spans: Array<{ text: string; start: number }> = [];
  let start = 0;
  const push = (end: number) => {
    const raw = value.slice(start, end);
    const text = raw.trim();
    if (text) spans.push({ text, start: start + raw.indexOf(text) });
  };
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const previous = value[index - 1] ?? "";
    const next = value[index + 1] ?? "";
    const decimal =
      character === "." && /\d/u.test(previous) && /\d/u.test(next);
    const abbreviation =
      character === "." &&
      /\b(?:yr|yrs|mo|mos|mth|mths)$/iu.test(value.slice(0, index));
    const dottedIdentifier =
      character === "." &&
      /[A-Za-z]/u.test(next) &&
      (/[A-Za-z0-9]/u.test(previous) || /[A-Z]/u.test(next));
    if (
      character !== ";" &&
      (character !== "." || decimal || abbreviation || dottedIdentifier)
    ) {
      continue;
    }
    push(index);
    start = index + 1;
  }
  push(value.length);
  return spans;
}

/**
 * Segment a JD while preserving every offset in the original source. Section
 * context is assigned here so the parser never has to reconstruct Markdown or
 * HTML and accidentally highlight the wrong characters.
 */
export function scanEvidenceSpans(description: string): EvidenceSpan[] {
  const scanText = offsetPreservingScanText(description);
  const htmlHeadings = htmlHeadingRanges(description);
  const spans: EvidenceSpan[] = [];
  let context: HeadingContext = null;
  let candidateLabelContext = false;
  let minimumLabelContext = false;

  for (const lineMatch of scanText.matchAll(/[^\r\n]+/gu)) {
    const markdownHeading = /^\s*#{1,6}\s+/u.test(lineMatch[0]);
    let content = lineContent(lineMatch.index, lineMatch[0]);
    if (!content) continue;
    const heading = headingContext(content.text);
    if (heading !== undefined) {
      context = heading;
      const field = experienceFieldLabel(content.text);
      candidateLabelContext = field.candidate;
      minimumLabelContext = field.minimum;
      continue;
    }
    if (
      markdownHeading ||
      htmlHeadings.some(
        (range) =>
          content && content.start >= range.start && content.start < range.end,
      )
    ) {
      context = null;
      candidateLabelContext = false;
      minimumLabelContext = false;
      continue;
    }

    const lineHeading = inlineHeading(content.text);
    if (lineHeading) {
      context = lineHeading.context;
      candidateLabelContext = lineHeading.candidateLabel;
      minimumLabelContext = lineHeading.minimumLabel;
      if (!lineHeading.remainder) continue;
      content = {
        text: lineHeading.remainder,
        start: content.start + lineHeading.remainderStart,
        end: content.end,
      };
    } else {
      const unknown = unknownInlineHeading(content.text);
      if (unknown) {
        context = null;
        candidateLabelContext = false;
        minimumLabelContext = false;
        if (!unknown.remainder) continue;
        content = {
          text: unknown.remainder,
          start: content.start + unknown.remainderStart,
          end: content.end,
        };
      }
    }

    for (const sentence of sentenceSpans(content.text)) {
      let text = sentence.text;
      let start = content.start + sentence.start;
      const sentenceHeading = inlineHeading(text);
      if (sentenceHeading) {
        context = sentenceHeading.context;
        candidateLabelContext = sentenceHeading.candidateLabel;
        minimumLabelContext = sentenceHeading.minimumLabel;
        if (!sentenceHeading.remainder) continue;
        start += sentenceHeading.remainderStart;
        text = sentenceHeading.remainder;
      } else {
        const unknown = unknownInlineHeading(text);
        if (unknown) {
          context = null;
          candidateLabelContext = false;
          minimumLabelContext = false;
          if (!unknown.remainder) continue;
          start += unknown.remainderStart;
          text = unknown.remainder;
        }
      }
      // `text` is the length-preserving scan view. The analyzer validates the
      // exact numeric slice against the original source before emitting; the
      // evidence payload itself is always sliced from `description`.
      spans.push({
        text,
        start,
        context,
        candidateLabel: candidateLabelContext,
        minimumLabel: minimumLabelContext,
      });
    }
  }
  return spans;
}

export function boundedEvidence(
  description: string,
  start: number,
  end: number,
  yearsStart: number,
  yearsEnd: number,
): {
  text: string;
  start: number;
  end: number;
  yearsStart: number;
  yearsEnd: number;
} {
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
