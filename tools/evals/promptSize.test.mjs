import { describe, expect, it } from "vitest";

import { promptSections, summarisePromptSizes } from "./promptSize.mjs";

const PROMPT = [
  "<task>",
  "Do the thing.",
  "</task>",
  "",
  "<candidate-evidence>",
  '{\n  "a": 1\n}',
  "</candidate-evidence>",
].join("\n");

describe("promptSections", () => {
  it("measures each tagged block including its own tags", () => {
    expect(promptSections(PROMPT)).toEqual([
      { tag: "task", chars: "<task>\nDo the thing.\n</task>".length },
      {
        tag: "candidate-evidence",
        chars: '<candidate-evidence>\n{\n  "a": 1\n}\n</candidate-evidence>'.length,
      },
    ]);
  });

  it("does not mistake a closing tag for a different block's opener", () => {
    const nestedLooking = "<rules>\n1) Use <skill-bank> indexes.\n</rules>";

    expect(promptSections(nestedLooking)).toEqual([
      { tag: "rules", chars: nestedLooking.length },
    ]);
  });

  it("returns nothing for a prompt with no tagged sections", () => {
    expect(promptSections("plain text")).toEqual([]);
  });
});

describe("summarisePromptSizes", () => {
  it("reports the spread across cases and the mean share of each section", () => {
    const summary = summarisePromptSizes([
      { total: 100, sections: [{ tag: "a", chars: 60 }, { tag: "b", chars: 20 }] },
      { total: 200, sections: [{ tag: "a", chars: 100 }, { tag: "b", chars: 60 }] },
    ]);

    expect(summary.cases).toBe(2);
    expect(summary.meanTotal).toBe(150);
    expect(summary.minTotal).toBe(100);
    expect(summary.maxTotal).toBe(200);
    // Sorted by mean size, largest first.
    expect(summary.sections.map((s) => s.tag)).toEqual(["a", "b"]);
    expect(summary.sections[0].meanChars).toBe(80);
    expect(summary.sections[1].meanChars).toBe(40);
  });

  it("averages a section over every case, counting a case that omits it as zero", () => {
    // <coverage-analysis> is absent whenever the caller passes no coverage, and
    // a share that silently ignored those cases would overstate it.
    const summary = summarisePromptSizes([
      { total: 100, sections: [{ tag: "a", chars: 50 }] },
      { total: 100, sections: [] },
    ]);

    expect(summary.sections[0]).toEqual({ tag: "a", meanChars: 25, meanShare: 0.25 });
  });

  it("returns null when there is nothing to summarise", () => {
    expect(summarisePromptSizes([])).toBeNull();
  });
});
