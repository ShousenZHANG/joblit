import { describe, expect, it } from "vitest";

import { stripHtml } from "./normalize";

describe("stripHtml", () => {
  it("preserves job-description block structure while removing HTML", () => {
    const html = `
      <section>
        <h2>Required Skills &amp; Experience</h2>
        <p>Build reliable systems.<br>Ship safely.</p>
        <ul>
          <li>5+ years in Java&nbsp;&amp;&nbsp;Spring</li>
          <li>3 years in AWS</li>
        </ul>
        <table>
          <tr><th>Skill</th><th>Years</th></tr>
          <tr><td>Python</td><td>4</td></tr>
        </table>
      </section>
    `;

    expect(stripHtml(html)).toBe(
      [
        "Required Skills & Experience",
        "",
        "Build reliable systems.",
        "Ship safely.",
        "",
        "- 5+ years in Java & Spring",
        "- 3 years in AWS",
        "",
        "Skill | Years",
        "Python | 4",
      ].join("\n"),
    );
  });

  it("normalizes Unicode without flattening existing plain-text lines", () => {
    expect(
      stripHtml(
        "Requirements：\r\n５＋ years’ experience\r\nPreferred： ２ years\r\nRange： ３–５ years",
      ),
    ).toBe(
      "Requirements:\n5+ years’ experience\nPreferred: 2 years\nRange: 3-5 years",
    );
  });

  it("keeps nested list and table blocks inside their logical units", () => {
    const html = [
      "<ul>",
      "<li><p>&ge; 5 years in Java</p></li>",
      "<li><div>&geq; 3 years in AWS</div></li>",
      "</ul>",
      "<table>",
      "<tr><th><p>Minimum</p></th><th><div>Maximum</div></th></tr>",
      "<tr><td><p>&plus; 2 years</p></td><td><div>&leq; 5 years</div></td></tr>",
      "</table>",
      "<p>&ge 4 years and &le 8 years; &plus 1 bonus year.</p>",
    ].join("");

    expect(stripHtml(html)).toBe(
      [
        "- ≥ 5 years in Java",
        "- ≥ 3 years in AWS",
        "",
        "Minimum | Maximum",
        "+ 2 years | ≤ 5 years",
        "",
        "≥ 4 years and ≤ 8 years; + 1 bonus year.",
      ].join("\n"),
    );
  });
});
