import { describe, expect, it } from "vitest";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { buildPdfFilename, resumeFilenameSegments } from "./pdfFilename";

const profile = (basics: Record<string, unknown>) => ({ basics });

describe("resumeFilenameSegments", () => {
  it("reads the raw profile name and headline", () => {
    expect(
      resumeFilenameSegments(
        profile({ fullName: "Alex Morgan", title: "Software Engineer" }),
      ),
    ).toEqual({ name: "Alex Morgan", title: "Software Engineer" });
  });

  it("degrades to empty segments rather than undefined for an absent profile", () => {
    expect(resumeFilenameSegments(null)).toEqual({ name: "", title: "" });
    expect(resumeFilenameSegments({})).toEqual({ name: "", title: "" });
    expect(buildPdfFilename(resumeFilenameSegments(null).name, "Engineer")).toBe(
      "Engineer_CV.pdf",
    );
  });

  // Regression: server routes used to pass mapResumeProfile(...).candidate.name,
  // which has crossed the LaTeX boundary. escapeLatex rewrites "~" as
  // "\textasciitilde{}" and the filename sanitizer keeps the letters, so the
  // download arrived as "Ana textasciitilde Silva ...". The raw profile is the
  // only source that agrees with the client-side builder.
  it("does not inherit LaTeX escapes the render input carries", () => {
    const raw = profile({ fullName: "Ana~Silva", title: "Engineer" });
    const escapedName = mapResumeProfile(raw).candidate.name;

    expect(escapedName).toContain("textasciitilde");
    expect(buildPdfFilename(escapedName, "Engineer")).toContain("textasciitilde");
    expect(
      buildPdfFilename(resumeFilenameSegments(raw).name, "Engineer"),
    ).toBe("Ana Silva Engineer_CV.pdf");
  });
});
