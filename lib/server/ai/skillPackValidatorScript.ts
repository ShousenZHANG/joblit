/**
 * Source shipped as scripts/validate.mjs inside Skill Pack V3.
 *
 * Keep this zero-dependency: users run it with stock Node.js after generating
 * JSON in an external model.
 */
export const SKILL_PACK_VALIDATOR_MJS = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

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
      "latestExperience",
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
    if (typeof data.cvSummary !== "string" || !data.cvSummary.trim()) {
      fail("SCHEMA", "cvSummary missing or empty");
    } else if (data.cvSummary.trim().length > 2000) {
      fail("SCHEMA", "cvSummary exceeds 2000 chars");
    }

    const latestExperience = data.latestExperience;
    if (
      !latestExperience ||
      typeof latestExperience !== "object" ||
      Array.isArray(latestExperience)
    ) {
      fail("SCHEMA", "latestExperience object missing");
    } else {
      const extraLatestKeys = unexpectedKeys(latestExperience, [
        "addedBullets",
      ]);
      if (extraLatestKeys.length > 0) {
        fail(
          "SCHEMA",
          "unexpected latestExperience key(s): " +
            extraLatestKeys.join(", "),
        );
      }

      if (!Array.isArray(latestExperience.addedBullets)) {
        fail("SCHEMA", "latestExperience.addedBullets missing");
      } else {
        const addedBullets = latestExperience.addedBullets;
        if (addedBullets.length > 3) {
          fail(
            "ADDED_BULLETS_COUNT",
            "latestExperience.addedBullets has " +
              addedBullets.length +
              " items (max 3)",
          );
        }
        addedBullets.forEach((bullet, index) => {
          if (typeof bullet !== "string" || !bullet.trim()) {
            fail(
              "SCHEMA",
              "added bullet " +
                (index + 1) +
                " is not a non-empty string",
            );
            return;
          }
          if (bullet.length > 320) {
            fail(
              "BULLET_LENGTH",
              "added bullet " + (index + 1) + " exceeds 320 chars",
            );
          }
          if (hasUncleanBold(bullet)) {
            fail(
              "BOLD_MARKERS",
              "added bullet " + (index + 1) + " has unclean ** markers",
            );
          }
        });
      }
    }

    if (typeof data.cvSummary === "string") {
      if (hasUncleanBold(data.cvSummary)) {
        fail("BOLD_MARKERS", "cvSummary has unclean ** markers");
      }
      if (boldCount(data.cvSummary) < 1) {
        warn("BOLD_MARKERS", "cvSummary has no **bold** JD keyword");
      }
    }
  } else {
    const extraRootKeys = unexpectedKeys(data, ["cover"]);
    if (extraRootKeys.length > 0) {
      fail(
        "SCHEMA",
        "unexpected cover output key(s): " + extraRootKeys.join(", "),
      );
    }
    if (
      "cvSummary" in data ||
      "latestExperience" in data ||
      "skillsFinal" in data
    ) {
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

Hard gates include JSON validity, no code fences, exact target keys, zero to
three \`latestExperience.addedBullets\`, no skills fields, only the three cover
paragraph fields, string and length checks, and clean \`**bold**\` markers.
Cover word-count and keyword-bolding drift remain non-blocking warnings.
`;
