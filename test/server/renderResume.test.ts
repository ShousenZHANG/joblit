import { describe, expect, it } from "vitest";
import { renderResumeTex } from "@/lib/server/latex/renderResume";

describe("renderResumeTex", () => {
  it("replaces summary, skills, and bullets placeholders", () => {
    const output = renderResumeTex({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
        linkedinUrl: "https://linkedin.com/in/jane",
        linkedinText: "linkedin.com/in/jane",
      },
      summary: "Focused engineer.",
      skills: [
        { label: "Frontend", items: ["React", "TypeScript"] },
        { label: "Backend", items: ["Node.js"] },
      ],
      experiences: [
        {
          location: "Sydney, Australia",
          dates: "2023-2025",
          title: "Software Engineer",
          company: "Example Co",
          links: [{ label: "Demo", url: "https://demo.example.com" }],
          bullets: ["Delivered features", "Improved performance"],
        },
      ],
      projects: [
        {
          name: "Joblit",
          location: "Sydney, Australia",
          dates: "2024",
          stack: "Next.js, TypeScript",
          links: [{ label: "GitHub", url: "https://github.com/example" }],
          bullets: ["Shipped features"],
        },
      ],
      education: [
        {
          location: "Sydney",
          dates: "2023-2025",
          schoolDegree: "UNSW - MIT",
          detail: "WAM 80",
        },
        {
          location: "Jiangsu",
          dates: "2016-2020",
          schoolDegree: "JUST - BE",
        },
      ],
    });

    expect(output).toContain("Focused engineer.");
    expect(output).toContain("\\item Delivered features");
    expect(output).toContain("Frontend");
    expect(output).toContain("React, TypeScript");
    expect(output).toContain("Joblit");
    expect(output).toContain("Jane Doe");
    expect(output).toContain("Example Co");
    expect(output).toContain("\\href{https://demo.example.com}{Demo}");
  });

  /**
   * paracol typeset each column as its own PDF text object, so the left and
   * right runs landed on a baseline with no whitespace between them. A naive
   * ATS parser concatenated them into "Software EngineerSydney, Australia",
   * destroying the job-title and employer fields. Headers must now pair row N
   * of the left column with row N of the right column on one text line.
   */
  describe("entry headers stay machine-readable", () => {
    const output = renderResumeTex({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
        linkedinUrl: "https://linkedin.com/in/jane",
        linkedinText: "linkedin.com/in/jane",
      },
      summary: "Focused engineer.",
      skills: [{ label: "Backend", items: ["Node.js"] }],
      experiences: [
        {
          location: "Sydney, Australia",
          dates: "Mar 2026 - Jul 2026",
          title: "Integration Analyst",
          company: "Example Co",
          links: [],
          bullets: ["Delivered features"],
        },
        {
          location: "",
          dates: "2024",
          title: "Contractor",
          company: "Solo",
          links: [],
          bullets: [],
        },
      ],
      projects: [
        {
          name: "Joblit",
          location: "Sydney, Australia",
          dates: "2024",
          stack: "Next.js",
          links: [],
          bullets: ["Shipped features"],
        },
      ],
      education: [
        {
          location: "Sydney",
          dates: "2023-2025",
          schoolDegree: "UNSW - MIT",
          detail: "WAM 80",
        },
        {
          location: "Jiangsu",
          dates: "2016-2020",
          schoolDegree: "JUST - BE",
        },
      ],
    });

    it("never emits the multi-column entry environment", () => {
      // Assert on real control sequences, not bare substrings: the template
      // documents in a comment why paracol was removed.
      expect(output).not.toContain("\\begin{twocolentry}");
      expect(output).not.toContain("\\begin{threecolentry}");
      expect(output).not.toContain("\\usepackage{paracol}");
      expect(output).not.toContain("\\begin{paracol}");
    });

    it("pairs each left row with its right row on one line", () => {
      expect(output).toContain(
        "\\entryrow{\\textbf{Integration Analyst}}{Sydney, Australia}",
      );
      expect(output).toContain("\\entryrow{Example Co}{Mar 2026 - Jul 2026}");
      expect(output).toContain("\\entryrow{\\textbf{Joblit}}{Sydney, Australia}");
      expect(output).toContain("\\entryrow{\\textbf{UNSW - MIT}}{Sydney}");
      expect(output).toContain("\\entryrow{\\textit{WAM 80}}{2023-2025}");
    });

    it("drops a header row only when both halves are empty", () => {
      // No location: the title row keeps an empty right half rather than
      // shifting the dates up onto the title line.
      expect(output).toContain("\\entryrow{\\textbf{Contractor}}{}");
      expect(output).toContain("\\entryrow{Solo}{2024}");
      // Education without a detail line must not leave an empty row behind.
      expect(output).toContain("\\entryrow{\\textbf{JUST - BE}}{Jiangsu}");
      expect(output).not.toContain("\\entryrow{}{}");
    });
  });
});
