import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { DEMO_JOBS, DEMO_SKILLS } from "./ApplicationDemo.data";
import { GroundingProof } from "./GroundingProof";

const proof = en.landingExperience.proof;
const job = DEMO_JOBS[0];
const expectedSkills = job.skills.map(index => DEMO_SKILLS[index]);

function renderProof() {
  return render(<NextIntlClientProvider locale="en" messages={en}><GroundingProof /></NextIntlClientProvider>);
}

describe("GroundingProof", () => {
  afterEach(cleanup);

  it("shows the model's answer as positions, never as skill names", () => {
    renderProof();
    const figure = screen.getByRole("figure", { name: proof.label });
    const answer = within(figure).getByText(`[${job.skills.join(", ")}]`);
    expect(answer.tagName).toBe("CODE");
    for (const skill of DEMO_SKILLS) expect(answer.textContent).not.toContain(skill);
  });

  it("lights exactly the skills at those positions and passes only them to the résumé", () => {
    const { container } = renderProof();
    const rows = [...container.querySelectorAll("ol > li")];
    expect(rows).toHaveLength(DEMO_SKILLS.length);
    rows.forEach((row, index) => expect(row.textContent).toMatch(new RegExp(`^${index}${DEMO_SKILLS[index]}`)));

    const picked = rows.filter(row => row.hasAttribute("data-picked"));
    expect(picked.map(row => row.textContent!.replace(/^\d+/, "").replace(`, ${proof.selected}`, ""))).toEqual(expectedSkills);
    for (const row of picked) expect(row).toHaveTextContent(proof.selected);

    const resumeSkills = within(container.querySelector("dl")!).getByText(expectedSkills.join(", "));
    expect(resumeSkills.tagName).toBe("DD");
  });

  it("marks only technologies the job ad actually names", () => {
    const { container } = renderProof();
    const marks = [...container.querySelectorAll("blockquote mark")].map(mark => mark.textContent!);
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(job.technology).toContain(mark);
      expect(job.source).toContain(mark);
    }
    expect(container.querySelector("blockquote")!.textContent).toBe(job.source);
  });
});
