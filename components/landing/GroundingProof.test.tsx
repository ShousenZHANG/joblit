import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { DEMO_JOBS, DEMO_SKILLS, type DemoJob } from "./ApplicationDemo.data";
import { GroundingProof } from "./GroundingProof";

const proof = en.landingExperience.proof;
const chosen = (job: DemoJob) => job.skills.map(index => DEMO_SKILLS[index]);

function renderProof() {
  return render(<NextIntlClientProvider locale="en" messages={en}><GroundingProof /></NextIntlClientProvider>);
}

function pickedRows(panel: HTMLElement) {
  return [...panel.querySelectorAll("ol > li[data-picked]")]
    .map(row => row.textContent!.replace(/^\d+/, "").replace(`, ${proof.selected}`, ""));
}

describe("GroundingProof", () => {
  afterEach(cleanup);

  it.each(DEMO_JOBS.map(job => [job.id, job] as const))("resolves the %s role's positions into exactly those skills", async (id, job) => {
    const user = userEvent.setup();
    renderProof();
    await user.click(screen.getByRole("tab", { name: proof.roles[id] }));
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAccessibleName(proof.roles[id]);

    const answer = within(panel).getByText(`[${job.skills.join(", ")}]`);
    expect(answer.tagName).toBe("CODE");
    for (const skill of DEMO_SKILLS) expect(answer.textContent).not.toContain(skill);

    // Rows keep the profile's order; the résumé keeps the model's ranking.
    expect(new Set(pickedRows(panel))).toEqual(new Set(chosen(job)));
    const resumeSkills = within(panel.querySelector("dl")!).getByText(chosen(job).join(", "));
    expect(resumeSkills.tagName).toBe("DD");

    const quote = panel.querySelector("blockquote")!;
    expect(quote.textContent).toBe(job.source);
    for (const mark of quote.querySelectorAll("mark")) {
      expect(job.technology).toContain(mark.textContent);
    }
  });

  it("numbers every skill in the profile's own order", () => {
    const { container } = renderProof();
    const rows = [...container.querySelectorAll("ol > li")];
    expect(rows).toHaveLength(DEMO_SKILLS.length);
    rows.forEach((row, index) => expect(row.textContent).toMatch(new RegExp(`^${index}${DEMO_SKILLS[index]}`)));
  });

  it("moves between roles from the keyboard", async () => {
    const user = userEvent.setup();
    renderProof();
    const [first, second] = screen.getAllByRole("tab");
    expect(first).toHaveAttribute("aria-selected", "true");
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByText(`[${DEMO_JOBS[1].skills.join(", ")}]`)).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(within(screen.getByRole("tabpanel")).getByText(`[${DEMO_JOBS.at(-1)!.skills.join(", ")}]`)).toBeInTheDocument();
  });
});
