/**
 * Source of the `scripts/validate.mjs` file shipped inside the V2 skill pack.
 *
 * Kept as a string constant (not a real .mjs in the repo) because the pack is
 * assembled in-memory from { name, content } file descriptors. This is a
 * standalone Node ESM script with ZERO dependencies: the external user runs it
 * on the model's JSON output before pasting it back into Joblit, turning the
 * prose "quality gates" self-check into a deterministic, machine-enforced gate.
 *
 * It mirrors the server-side contract (promptContract.ts schemas + the embedded
 * quality gates) but is fully self-contained so it runs anywhere `node` exists.
 */
export const SKILL_PACK_VALIDATOR_MJS = `#!/usr/bin/env node
/**
 * Joblit tailoring output validator — zero-dependency Node ESM.
 *
 * Usage:
 *   node scripts/validate.mjs <output.json> --target=resume|cover [--locale=en-AU|zh-CN]
 *
 * Exit codes: 0 = safe to import (no hard failures), 1 = hard failure(s),
 * 2 = bad usage / unreadable file. Warnings never block import.
 *
 * This is the deterministic counterpart to instructions/quality-gates.md:
 * run it before pasting the JSON back into Joblit.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const args = argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const getFlag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(\`--\${name}=\`));
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

// Pull the real cover word range from the shipped locale file when present, so
// the threshold always matches the pack the model was given.
let coverWordRange = locale === "zh-CN" ? { min: 400, max: 600 } : { min: 250, max: 400 };
try {
  const lp = JSON.parse(readFileSync(join(here, "..", "rules", "locale", \`\${locale}.json\`), "utf8"));
  if (lp && lp.coverWordRange && typeof lp.coverWordRange.min === "number") {
    coverWordRange = lp.coverWordRange;
  }
} catch {
  // locale file optional — fall back to defaults above
}

let raw;
try {
  raw = readFileSync(file, "utf8");
} catch (e) {
  console.error(\`Cannot read \${file}: \${e.message}\`);
  exit(2);
}

const fails = [];
const warns = [];
const fail = (code, msg) => fails.push(\`\${code}: \${msg}\`);
const warn = (code, msg) => warns.push(\`\${code}: \${msg}\`);

const stripBold = (s) => String(s).replace(/\\*\\*/g, "");
// Clean markers only: reject "** keyword" / "keyword **" (space inside the
// markers). A space OUTSIDE the span (normal "word **bold**") is fine, so check
// each **...** span for leading/trailing inner whitespace rather than any space
// adjacent to a ** sequence.
const hasUncleanBold = (s) =>
  (String(s).match(/\\*\\*([^*]*)\\*\\*/g) || []).some((span) => {
    const inner = span.slice(2, -2);
    return inner !== inner.trim();
  });
const boldCount = (s) => (String(s).match(/\\*\\*[^*]+\\*\\*/g) || []).length;
const countWords = (s) => {
  const t = stripBold(s);
  return locale === "zh-CN"
    ? (t.match(/[\\u4e00-\\u9fff]/g) || []).length
    : t.trim().split(/\\s+/).filter(Boolean).length;
};

if (/\\\`\\\`\\\`/.test(raw)) fail("JSON_ONLY", "Output contains code fences (\\\`\\\`\\\`) — return raw JSON only");

let data = null;
try {
  data = JSON.parse(raw);
} catch (e) {
  fail("JSON_VALID", \`Not valid JSON: \${e.message}\`);
}

if (data && typeof data === "object") {
  if (target === "resume") {
    if (typeof data.cvSummary !== "string" || !data.cvSummary.trim()) {
      fail("SCHEMA", "cvSummary missing or empty");
    }
    if (!data.latestExperience || !Array.isArray(data.latestExperience.bullets)) {
      fail("SCHEMA", "latestExperience.bullets missing");
    }
    if (!Array.isArray(data.skillsFinal)) fail("SCHEMA", "skillsFinal missing");
    if ("cover" in data) fail("TARGET_LEAK", "resume output must not contain a cover payload");
    if ("skillsAdditions" in data) fail("SKILLS", "never output skillsAdditions — return skillsFinal only");
    if (Array.isArray(data.skillsFinal) && data.skillsFinal.length > 5) {
      fail("SKILLS_COUNT", \`skillsFinal has \${data.skillsFinal.length} categories (max 5)\`);
    }
    const bullets = (data.latestExperience && data.latestExperience.bullets) || [];
    if (Array.isArray(bullets)) {
      if (bullets.length < 1) fail("SCHEMA", "need at least one bullet");
      bullets.forEach((b, i) => {
        if (typeof b !== "string") return fail("SCHEMA", \`bullet \${i + 1} is not a string\`);
        if (b.length > 250) fail("BULLET_LENGTH", \`bullet \${i + 1} exceeds 250 chars (ATS)\`);
        if (hasUncleanBold(b)) fail("BOLD_MARKERS", \`bullet \${i + 1} has unclean ** markers\`);
      });
    }
    if (typeof data.cvSummary === "string") {
      if (hasUncleanBold(data.cvSummary)) fail("BOLD_MARKERS", "cvSummary has unclean ** markers");
      if (boldCount(data.cvSummary) < 1) warn("BOLD_MARKERS", "cvSummary has no **bold** JD keyword");
    }
  } else {
    const c = data.cover;
    if (!c || typeof c !== "object") {
      fail("SCHEMA", "cover object missing");
    } else {
      if ("cvSummary" in data || "latestExperience" in data || "skillsFinal" in data) {
        fail("TARGET_LEAK", "cover output must not contain resume keys");
      }
      for (const k of ["paragraphOne", "paragraphTwo", "paragraphThree"]) {
        if (!c[k] || !String(c[k]).trim()) fail("STRUCTURE", \`cover.\${k} missing or empty\`);
        if (c[k] && hasUncleanBold(c[k])) fail("BOLD_MARKERS", \`cover.\${k} has unclean ** markers\`);
      }
      const allParas = \`\${c.paragraphOne || ""} \${c.paragraphTwo || ""} \${c.paragraphThree || ""}\`;
      const total = countWords(allParas);
      if (total < coverWordRange.min || total > coverWordRange.max) {
        warn("WORD_COUNT", \`total \${total} outside \${coverWordRange.min}-\${coverWordRange.max} (\${locale})\`);
      }
      if (boldCount(allParas) < 3) {
        warn("KEYWORD_BOLDING", \`only \${boldCount(allParas)} bolded keyword(s) across paragraphs (want >=3)\`);
      }
    }
  }
}

if (fails.length === 0 && warns.length === 0) {
  console.log(\`PASS (\${target}, \${locale}) — all gates green, safe to import.\`);
  exit(0);
}

console.log(\`Validation report for \${file} (target=\${target}, locale=\${locale}):\`);
for (const f of fails) console.log(\`  FAIL  \${f}\`);
for (const w of warns) console.log(\`  WARN  \${w}\`);

if (fails.length > 0) {
  console.log(\`\\n\${fails.length} hard failure(s) — fix before importing to Joblit.\`);
  exit(1);
}
console.log(\`\\n0 hard failures, \${warns.length} warning(s) — safe to import; review warnings.\`);
exit(0);
`;

export const SKILL_PACK_VALIDATOR_README = `# scripts/validate.mjs

Deterministic, zero-dependency validator for the JSON your AI returns. Run it
before pasting the output back into Joblit — it enforces the same contract the
Joblit server checks on import, so you catch problems locally first.

\`\`\`bash
node scripts/validate.mjs my-output.json --target=resume --locale=en-AU
node scripts/validate.mjs my-output.json --target=cover  --locale=zh-CN
\`\`\`

- Exit 0: safe to import (no hard failures).
- Exit 1: hard failure(s) printed — fix and re-run.
- Exit 2: usage error or unreadable file.

Hard gates: JSON validity, no code fences, correct target keys (no resume/cover
leakage), \`skillsFinal\` <= 5 categories, no \`skillsAdditions\`, bullet length,
clean \`**bold**\` markers. Warnings (non-blocking): missing keyword bolding and
cover word-count drift. Word range is read from \`rules/locale/<locale>.json\`.
`;
