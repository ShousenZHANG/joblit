import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { SkillsSection } from "./SkillsSection";
import { CoverParagraphsSection } from "./CoverParagraphsSection";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

const skillsAdditions: AiContent["cv"]["skillsAdditions"] = [
  { label: "Backend", items: ["Spring Boot", "Spring Cloud"], accepted: true },
  { label: "Cloud", items: ["AWS", "Docker"], accepted: false },
];

const cover: AiContent["cover"] = {
  paragraphOne: { aiText: "Hook paragraph.", accepted: true },
  paragraphTwo: { aiText: "Match paragraph.", accepted: true },
  paragraphThree: { aiText: "Close paragraph.", accepted: true },
};

describe("tailor edit sections — accessibility", () => {
  it("SkillsSection has no axe violations", async () => {
    const { container } = render(
      <SkillsSection skillsAdditions={skillsAdditions} onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("CoverParagraphsSection has no axe violations", async () => {
    const { container } = render(
      <CoverParagraphsSection cover={cover} onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
