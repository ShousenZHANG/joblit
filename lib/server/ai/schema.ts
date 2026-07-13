import { z } from "zod";
import { toStringValue } from "@/lib/shared/utils/text";

const TailorModelOutputSchema = z.object({
  cvSummary: z.string().trim().max(1400).optional().default(""),
  cover: z
    .object({
      candidateTitle: z.string().trim().max(200).optional().default(""),
      subject: z.string().trim().max(240).optional().default(""),
      date: z.string().trim().max(120).optional().default(""),
      salutation: z.string().trim().max(200).optional().default(""),
      paragraphOne: z.string().trim().max(1400).optional().default(""),
      paragraphTwo: z.string().trim().max(1400).optional().default(""),
      paragraphThree: z.string().trim().max(1400).optional().default(""),
      closing: z.string().trim().max(200).optional().default(""),
      signatureName: z.string().trim().max(200).optional().default(""),
    })
    .optional()
    .default({
      candidateTitle: "",
      subject: "",
      date: "",
      salutation: "",
      paragraphOne: "",
      paragraphTwo: "",
      paragraphThree: "",
      closing: "",
      signatureName: "",
    }),
});

type TailorModelOutput = z.infer<typeof TailorModelOutputSchema>;

function pickFirstText(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toStringValue(obj[key]).trim();
    if (value) return value;
  }
  return "";
}

function normalizeCover(value: unknown) {
  if (!value) {
    return {
      candidateTitle: "",
      subject: "",
      date: "",
      salutation: "",
      paragraphOne: "",
      paragraphTwo: "",
      paragraphThree: "",
      closing: "",
      signatureName: "",
    };
  }
  if (typeof value === "string") {
    const parts = value
      .split(/\n{2,}|\r\n\r\n|•|\n-/)
      .map((part) => part.trim())
      .filter(Boolean);
    return {
      candidateTitle: "",
      subject: "",
      date: "",
      salutation: "",
      paragraphOne: parts[0] ?? "",
      paragraphTwo: parts[1] ?? "",
      paragraphThree: parts[2] ?? "",
      closing: "",
      signatureName: "",
    };
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => toStringValue(item).trim()).filter(Boolean);
    return {
      candidateTitle: "",
      subject: "",
      date: "",
      salutation: "",
      paragraphOne: parts[0] ?? "",
      paragraphTwo: parts[1] ?? "",
      paragraphThree: parts[2] ?? "",
      closing: "",
      signatureName: "",
    };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      candidateTitle: pickFirstText(record, ["candidateTitle", "title"]),
      subject: pickFirstText(record, ["subject"]),
      date: pickFirstText(record, ["date"]),
      salutation: pickFirstText(record, ["salutation", "greeting"]),
      paragraphOne: pickFirstText(record, [
        "paragraphOne",
        "paragraph1",
        "p1",
        "intro",
        "opening",
      ]),
      paragraphTwo: pickFirstText(record, [
        "paragraphTwo",
        "paragraph2",
        "p2",
        "body",
        "experience",
      ]),
      paragraphThree: pickFirstText(record, [
        "paragraphThree",
        "paragraph3",
        "p3",
        "closing",
        "interest",
      ]),
      closing: pickFirstText(record, ["closing", "signoff"]),
      signatureName: pickFirstText(record, ["signatureName", "name", "signature"]),
    };
  }
  return {
    candidateTitle: "",
    subject: "",
    date: "",
    salutation: "",
    paragraphOne: "",
    paragraphTwo: "",
    paragraphThree: "",
    closing: "",
    signatureName: "",
  };
}

function normalizeTailorPayload(raw: unknown): TailorModelOutput {
  if (!raw || typeof raw !== "object") {
    return { cvSummary: "", cover: normalizeCover(undefined) };
  }
  if (Array.isArray(raw)) {
    const firstObject = raw.find((item) => item && typeof item === "object");
    return firstObject
      ? normalizeTailorPayload(firstObject)
      : { cvSummary: "", cover: normalizeCover(undefined) };
  }
  const record = raw as Record<string, unknown>;
  const cvSummary = pickFirstText(record, [
    "cvSummary",
    "summary",
    "cv_summary",
    "resumeSummary",
    "resume_summary",
  ]);
  const cover = normalizeCover(
    record.cover ?? record.coverLetter ?? record.cover_letter ?? record.letter ?? record.coverletter,
  );
  return { cvSummary, cover };
}

function recoverFromText(
  input: string,
): { cvSummary: string; cover: { paragraphOne: string; paragraphTwo: string; paragraphThree: string } } | null {
  const text = input
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/g, "")
    .trim();

  const findSection = (pattern: RegExp) => {
    const match = pattern.exec(text);
    return match?.[1]?.trim() ?? "";
  };

  const summary =
    findSection(/cv summary\s*[:\-]?\s*([\s\S]*?)(?:cover|paragraph|p1|$)/i) ||
    findSection(/summary\s*[:\-]?\s*([\s\S]*?)(?:cover|paragraph|p1|$)/i);

  const paragraphOne =
    findSection(/paragraph\s*(?:one|1)\s*[:\-]?\s*([\s\S]*?)(?:paragraph\s*(?:two|2)|p2|$)/i) ||
    findSection(/p1\s*[:\-]?\s*([\s\S]*?)(?:p2|$)/i);

  const paragraphTwo =
    findSection(/paragraph\s*(?:two|2)\s*[:\-]?\s*([\s\S]*?)(?:paragraph\s*(?:three|3)|p3|$)/i) ||
    findSection(/p2\s*[:\-]?\s*([\s\S]*?)(?:p3|$)/i);

  const paragraphThree =
    findSection(/paragraph\s*(?:three|3)\s*[:\-]?\s*([\s\S]*?)(?:$)/i) ||
    findSection(/p3\s*[:\-]?\s*([\s\S]*?)(?:$)/i);

  if (!summary && !paragraphOne && !paragraphTwo && !paragraphThree) {
    const parts = text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    const recovered = {
      cvSummary: parts[0] ?? "",
      cover: {
        paragraphOne: parts[1] ?? "",
        paragraphTwo: parts[2] ?? "",
        paragraphThree: parts[3] ?? "",
      },
    };
    const length =
      recovered.cvSummary.length +
      recovered.cover.paragraphOne.length +
      recovered.cover.paragraphTwo.length +
      recovered.cover.paragraphThree.length;
    if (length < 80) {
      return null;
    }
    return recovered;
  }

  const recovered = {
    cvSummary: summary,
    cover: {
      paragraphOne,
      paragraphTwo,
      paragraphThree,
    },
  };
  const length =
    recovered.cvSummary.length +
    recovered.cover.paragraphOne.length +
    recovered.cover.paragraphTwo.length +
    recovered.cover.paragraphThree.length;
  if (length < 80) {
    return null;
  }
  return recovered;
}

function repairJsonText(input: string) {
  let text = input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/\uFEFF/g, "")
    .trim();

  // Remove trailing commas before closing braces/brackets.
  text = text.replace(/,\s*([}\]])/g, "$1");
  // Escape invalid backslashes (e.g. \C) so JSON.parse can recover.
  text = text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");

  // Replace unescaped newlines within JSON strings with \n
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\n") {
        result += "\\n";
        continue;
      }
      if (char === "\r") {
        continue;
      }
      if (char === "\"" && !escaped) {
        inString = false;
      }
      escaped = char === "\\" && !escaped;
      result += char;
    } else {
      if (char === "\"") {
        inString = true;
        escaped = false;
      }
      result += char;
    }
  }

  return result;
}

export function parseTailorModelOutput(raw: string): TailorModelOutput | null {
  const text = raw.trim();

  const tryParse = (value: string) => {
    const parsed = JSON.parse(value);
    const result = TailorModelOutputSchema.safeParse(parsed);
    if (result.success) return result.data;
    const normalized = normalizeTailorPayload(parsed);
    const normalizedResult = TailorModelOutputSchema.safeParse(normalized);
    return normalizedResult.success ? normalizedResult.data : null;
  };

  try {
    return tryParse(text);
  } catch {
    // continue
  }

  const withoutFences = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return tryParse(withoutFences);
  } catch {
    // continue
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try {
      return tryParse(slice);
    } catch {
      // continue
    }
  }

  const repaired = repairJsonText(text);
  try {
    return tryParse(repaired);
  } catch {
    // continue
  }

  const repairedFences = repairJsonText(withoutFences);
  try {
    return tryParse(repairedFences);
  } catch {
    // continue
  }

  if (start >= 0 && end > start) {
    const repairedSlice = repairJsonText(text.slice(start, end + 1));
    try {
      return tryParse(repairedSlice);
    } catch {
      // continue
    }
  }

  const recovered = recoverFromText(text);
  if (recovered) {
    const recoveredResult = TailorModelOutputSchema.safeParse(recovered);
    if (recoveredResult.success) {
      return recoveredResult.data;
    }
  }

  return null;
}
