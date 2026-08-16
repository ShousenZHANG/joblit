import { CV_SUMMARY_LENGTH } from "@/lib/shared/schemas/applicationGenerationOutput";

/**
 * Source shipped as scripts/validate.mjs inside Skill Pack V3.
 *
 * Keep this zero-dependency: users run it with stock Node.js after generating
 * JSON in an external model. Numeric bounds are interpolated from the canonical
 * schema rather than retyped, so a contract change cannot leave the downloaded
 * validator passing output the server will reject.
 */
export const SKILL_PACK_VALIDATOR_MJS = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const SUMMARY_MIN = ${CV_SUMMARY_LENGTH.min};
const SUMMARY_MAX = ${CV_SUMMARY_LENGTH.max};
// Mirrors ResumeProfileSchema.skills, which the output schema shipped alongside
// this script (schema/resume-output.schema.json) states as maxItems.
const MAX_GROUPS = 12;
const MAX_ITEMS = 30;

const args = argv.slice(2);
const file = args.find((argument) => !argument.startsWith("--"));
const getFlag = (name, fallback) => {
  const hit = args.find((argument) => argument.startsWith("--" + name + "="));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const target = getFlag("target", "resume");
const locale = getFlag("locale", "en-AU");

if (!file || (target !== "resume" && target !== "cover")) {
  console.error(
    "Usage: node scripts/validate.mjs <output.json> --target=resume|cover [--locale=en-AU|zh-CN]",
  );
  exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
let coverWordRange =
  locale === "zh-CN" ? { min: 400, max: 600 } : { min: 300, max: 400 };
try {
  const localePath = join(
    here,
    "..",
    "rules",
    "locale",
    locale + ".json",
  );
  const localeProfile = JSON.parse(readFileSync(localePath, "utf8"));
  if (
    localeProfile &&
    localeProfile.coverWordRange &&
    typeof localeProfile.coverWordRange.min === "number" &&
    typeof localeProfile.coverWordRange.max === "number"
  ) {
    coverWordRange = localeProfile.coverWordRange;
  }
} catch {
  // The locale file is optional when the validator is copied out of the pack.
}

// Group sizes from the packaged resume snapshot, when the pack shipped one.
// With it, an index that does not exist on the profile fails here instead of at
// import; without it only the index shape can be checked.
let skillBank = null;
try {
  const snapshotPath = join(here, "..", "context", "resume-snapshot.json");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  if (snapshot && Array.isArray(snapshot.skills)) {
    skillBank = snapshot.skills.map((group) =>
      group && Array.isArray(group.items) ? group.items.length : 0,
    );
  }
} catch {
  // No packaged context; index-existence checking is skipped.
}

let raw;
try {
  raw = readFileSync(file, "utf8");
} catch (error) {
  console.error("Cannot read " + file + ": " + error.message);
  exit(2);
}

const failures = [];
const warnings = [];
const fail = (code, message) => failures.push(code + ": " + message);
const warn = (code, message) => warnings.push(code + ": " + message);
const stripBold = (value) => String(value).replace(/\\*\\*/g, "");
const hasUncleanBold = (value) =>
  (String(value).match(/\\*\\*([^*]*)\\*\\*/g) || []).some((span) => {
    const inner = span.slice(2, -2);
    return inner !== inner.trim();
  });
const boldCount = (value) =>
  (String(value).match(/\\*\\*[^*]+\\*\\*/g) || []).length;
const countWords = (value) => {
  const text = stripBold(value);
  return locale === "zh-CN"
    ? (text.match(/[\\u4e00-\\u9fff]/g) || []).length
    : text.trim().split(/\\s+/).filter(Boolean).length;
};
const unexpectedKeys = (value, allowed) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).filter((key) => !allowed.includes(key))
    : [];
const isIndex = (value, exclusiveMax) =>
  Number.isInteger(value) && value >= 0 && value < exclusiveMax;

if (/\\x60\\x60\\x60/.test(raw)) {
  fail("JSON_ONLY", "Output contains code fences; return raw JSON only");
}

let data = null;
try {
  data = JSON.parse(raw);
} catch (error) {
  fail("JSON_VALID", "Not valid JSON: " + error.message);
}

if (data && typeof data === "object" && !Array.isArray(data)) {
  if (target === "resume") {
    const extraRootKeys = unexpectedKeys(data, [
      "cvSummary",
      "skillsSelection",
    ]);
    if (extraRootKeys.length > 0) {
      fail(
        "SCHEMA",
        "unexpected resume key(s): " + extraRootKeys.join(", "),
      );
    }
    if ("cover" in data) {
      fail(
        "TARGET_LEAK",
        "resume output must not contain a cover payload",
      );
    }

    const summary =
      typeof data.cvSummary === "string" ? data.cvSummary.trim() : "";
    if (!summary) {
      fail("SCHEMA", "cvSummary missing or empty");
    } else {
      if (summary.length < SUMMARY_MIN || summary.length > SUMMARY_MAX) {
        fail(
          "SUMMARY_LENGTH",
          "cvSummary is " +
            summary.length +
            " chars; needs " +
            SUMMARY_MIN +
            "-" +
            SUMMARY_MAX,
        );
      }
      if (hasUncleanBold(summary)) {
        fail("BOLD_MARKERS", "cvSummary has unclean ** markers");
      }
      if (boldCount(summary) < 1) {
        warn("BOLD_MARKERS", "cvSummary has no **bold** JD keyword");
      }
    }

    const selection = data.skillsSelection;
    if (!Array.isArray(selection)) {
      fail("SCHEMA", "skillsSelection missing or not an array");
    } else if (selection.length < 1 || selection.length > MAX_GROUPS) {
      fail(
        "SELECTION_SIZE",
        "skillsSelection has " +
          selection.length +
          " group(s); needs 1-" +
          MAX_GROUPS,
      );
    } else {
      const seenGroups = new Set();
      selection.forEach((entry, index) => {
        const label = "skillsSelection[" + index + "]";
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          fail("SCHEMA", label + " is not an object");
          return;
        }
        const extraEntryKeys = unexpectedKeys(entry, ["group", "items"]);
        if (extraEntryKeys.length > 0) {
          fail(
            "SCHEMA",
            label + " has unexpected key(s): " + extraEntryKeys.join(", "),
          );
        }

        let groupOk = true;
        if (!isIndex(entry.group, MAX_GROUPS)) {
          fail(
            "SELECTION_INDEX",
            label + ".group must be an integer 0-" + (MAX_GROUPS - 1),
          );
          groupOk = false;
        } else if (seenGroups.has(entry.group)) {
          fail(
            "SELECTION_DUPLICATE",
            "group " + entry.group + " is selected more than once",
          );
        } else {
          seenGroups.add(entry.group);
        }
        if (groupOk && skillBank && entry.group >= skillBank.length) {
          fail(
            "SELECTION_OUT_OF_BANK",
            "group " + entry.group + " does not exist on the resume snapshot",
          );
          groupOk = false;
        }

        if (
          !Array.isArray(entry.items) ||
          entry.items.length < 1 ||
          entry.items.length > MAX_ITEMS
        ) {
          fail(
            "SCHEMA",
            label + ".items must be an array of 1-" + MAX_ITEMS + " indexes",
          );
          return;
        }
        const groupSize =
          groupOk && skillBank ? skillBank[entry.group] : null;
        const seenItems = new Set();
        entry.items.forEach((item, itemIndex) => {
          const itemLabel = label + ".items[" + itemIndex + "]";
          if (!isIndex(item, MAX_ITEMS)) {
            fail(
              "SELECTION_INDEX",
              itemLabel + " must be an integer 0-" + (MAX_ITEMS - 1),
            );
            return;
          }
          if (seenItems.has(item)) {
            fail("SELECTION_DUPLICATE", itemLabel + " repeats index " + item);
          }
          seenItems.add(item);
          if (groupSize !== null && item >= groupSize) {
            fail(
              "SELECTION_OUT_OF_BANK",
              itemLabel +
                " points past group " +
                entry.group +
                ", which has " +
                groupSize +
                " skill(s)",
            );
          }
        });
      });
    }
  } else {
    const extraRootKeys = unexpectedKeys(data, ["cover"]);
    if (extraRootKeys.length > 0) {
      fail(
        "SCHEMA",
        "unexpected cover output key(s): " + extraRootKeys.join(", "),
      );
    }
    if ("cvSummary" in data || "skillsSelection" in data) {
      fail("TARGET_LEAK", "cover output must not contain resume keys");
    }

    const cover = data.cover;
    if (!cover || typeof cover !== "object" || Array.isArray(cover)) {
      fail("SCHEMA", "cover object missing");
    } else {
      const paragraphKeys = [
        "paragraphOne",
        "paragraphTwo",
        "paragraphThree",
      ];
      const extraCoverKeys = unexpectedKeys(cover, paragraphKeys);
      if (extraCoverKeys.length > 0) {
        fail(
          "SCHEMA",
          "unexpected cover key(s): " + extraCoverKeys.join(", "),
        );
      }
      for (const key of paragraphKeys) {
        if (typeof cover[key] !== "string" || !cover[key].trim()) {
          fail("STRUCTURE", "cover." + key + " missing or empty");
        }
        if (
          typeof cover[key] === "string" &&
          cover[key].trim().length > 2000
        ) {
          fail("STRUCTURE", "cover." + key + " exceeds 2000 chars");
        }
        if (
          typeof cover[key] === "string" &&
          hasUncleanBold(cover[key])
        ) {
          fail(
            "BOLD_MARKERS",
            "cover." + key + " has unclean ** markers",
          );
        }
      }

      const allParagraphs =
        (cover.paragraphOne || "") +
        " " +
        (cover.paragraphTwo || "") +
        " " +
        (cover.paragraphThree || "");
      const total = countWords(allParagraphs);
      if (total < coverWordRange.min || total > coverWordRange.max) {
        warn(
          "WORD_COUNT",
          "total " +
            total +
            " outside " +
            coverWordRange.min +
            "-" +
            coverWordRange.max +
            " (" +
            locale +
            ")",
        );
      }
      if (boldCount(allParagraphs) < 3) {
        warn(
          "KEYWORD_BOLDING",
          "only " +
            boldCount(allParagraphs) +
            " bolded keyword(s) across paragraphs (want >=3)",
        );
      }
    }
  }
} else {
  fail("SCHEMA", "top-level JSON value must be an object");
}

if (failures.length === 0 && warnings.length === 0) {
  console.log(
    "PASS (" + target + ", " + locale + ") - all gates green, safe to import.",
  );
  exit(0);
}

console.log(
  "Validation report for " +
    file +
    " (target=" +
    target +
    ", locale=" +
    locale +
    "):",
);
for (const failure of failures) console.log("  FAIL  " + failure);
for (const warning of warnings) console.log("  WARN  " + warning);

if (failures.length > 0) {
  console.log(
    "\\n" + failures.length + " hard failure(s) - fix before importing to Joblit.",
  );
  exit(1);
}
console.log(
  "\\n0 hard failures, " +
    warnings.length +
    " warning(s) - safe to import; review warnings.",
);
exit(0);
`;

export const SKILL_PACK_VALIDATOR_README = `# scripts/validate.mjs

Deterministic, zero-dependency validator for the JSON your AI returns. Run it
before pasting output back into Joblit; it enforces the same current contract
the Joblit server checks on import.

~~~bash
node scripts/validate.mjs my-output.json --target=resume --locale=en-AU
node scripts/validate.mjs my-output.json --target=cover  --locale=zh-CN
~~~

- Exit 0: safe to import (warnings may still be shown).
- Exit 1: hard contract failure; fix and re-run.
- Exit 2: usage error or unreadable file.

Resume hard gates: JSON validity, no code fences, exactly \`cvSummary\` and
\`skillsSelection\`, a ${CV_SUMMARY_LENGTH.min}-${CV_SUMMARY_LENGTH.max}
character summary, clean \`**bold**\` markers, and a \`skillsSelection\` made of
integer indexes only, each group selected once and each index unique within its
group. When the pack was exported with \`context/resume-snapshot.json\`, indexes
are also checked against the real group sizes; without it only their shape can
be checked, and Joblit performs the existence check at import.

Cover hard gates: only the three body paragraph fields, string and length
checks, and clean \`**bold**\` markers. Cover word-count and keyword-bolding
drift remain non-blocking warnings.

This validator cannot see your master profile's wording, so the summary's
grounding rules — the role title must be present, and every number and skill
must already exist on the profile — are enforced by Joblit on import.
`;
