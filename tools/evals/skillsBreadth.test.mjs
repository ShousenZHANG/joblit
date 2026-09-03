import { describe, expect, it } from "vitest";

import { skillsBreadth, summariseBreadth } from "./skillsBreadth.mjs";

const BANK = [
  { category: "Languages", items: ["Python", "Go", "SQL"] },
  { category: "Cloud", items: ["AWS", "Kubernetes"] },
  { category: "Data", items: ["Airflow", "Kafka", "Snowflake", "dbt"] },
];

describe("skillsBreadth", () => {
  it("counts the selected groups and items against the bank they came from", () => {
    const breadth = skillsBreadth(
      [
        { group: 0, items: [0, 2] },
        { group: 2, items: [1] },
      ],
      BANK,
    );

    expect(breadth).toEqual({
      groups: 2,
      items: 3,
      bankGroups: 3,
      bankItems: 9,
      itemRatio: 3 / 9,
    });
  });

  it("reports a full-bank selection as a ratio of 1, which is the failure this measures", () => {
    const breadth = skillsBreadth(
      [
        { group: 0, items: [0, 1, 2] },
        { group: 1, items: [0, 1] },
        { group: 2, items: [0, 1, 2, 3] },
      ],
      BANK,
    );

    expect(breadth.itemRatio).toBe(1);
    expect(breadth.items).toBe(9);
  });

  it("returns null when there is no selection to measure, rather than a zero that reads as filtering", () => {
    expect(skillsBreadth(undefined, BANK)).toBeNull();
    expect(skillsBreadth([], BANK)).toBeNull();
    expect(skillsBreadth([{ group: 0, items: [0] }], [])).toBeNull();
  });

  it("ignores indexes that fall outside the bank instead of counting them as selected", () => {
    // The import gate rejects these, but a trace row is written for rejected
    // attempts too, and an out-of-range index must not inflate the breadth.
    const breadth = skillsBreadth([{ group: 0, items: [0, 99] }, { group: 7, items: [0] }], BANK);

    expect(breadth.groups).toBe(1);
    expect(breadth.items).toBe(1);
  });
});

describe("summariseBreadth", () => {
  it("averages only the rows that carried a selection", () => {
    const summary = summariseBreadth([
      { breadth: { groups: 2, items: 3, bankGroups: 3, bankItems: 9, itemRatio: 3 / 9 } },
      { breadth: { groups: 3, items: 9, bankGroups: 3, bankItems: 9, itemRatio: 1 } },
      { breadth: null },
      {},
    ]);

    expect(summary).toEqual({
      measured: 2,
      meanItems: 6,
      meanBankItems: 9,
      meanRatio: (1 / 3 + 1) / 2,
      fullBank: 1,
    });
  });

  it("returns null when nothing in the run carried a selection", () => {
    expect(summariseBreadth([{ breadth: null }, {}])).toBeNull();
  });
});
