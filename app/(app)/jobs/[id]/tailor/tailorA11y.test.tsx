import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { CoverParagraphsSection } from "./CoverParagraphsSection";
import { SummarySection } from "./SummarySection";
import { BulletsSection } from "./BulletsSection";
import { PageHeading } from "@/components/app-shell/PageHeading";
import messages from "@/messages/en.json";
import type { AiContent, AiSummary } from "@/lib/shared/schemas/aiContent";

const renderIntl = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );

const cover: AiContent["cover"] = {
  paragraphOne: { aiText: "Hook paragraph.", accepted: true },
  paragraphTwo: { aiText: "Match paragraph.", accepted: true },
  paragraphThree: { aiText: "Close paragraph.", accepted: true },
};

const summary: AiSummary = {
  aiText: "Senior engineer with 5 years building production systems.",
  originalText: "Engineer with experience.",
  accepted: true,
};

const latestExperience: AiContent["cv"]["latestExperience"] = {
  experienceIndex: 0,
  addedBullets: [
    { text: "Shipped the billing service.", accepted: true, qualityGate: { passed: true } },
    {
      text: "Led an unrelated migration.",
      accepted: false,
      qualityGate: { passed: false, reason: "ungrounded" },
    },
  ],
};

describe("tailor edit sections — accessibility", () => {
  it("CoverParagraphsSection has no axe violations", async () => {
    const { container } = renderIntl(
      <CoverParagraphsSection cover={cover} onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("SummarySection has no axe violations", async () => {
    const { container } = renderIntl(
      <SummarySection summary={summary} onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("BulletsSection has no axe violations", async () => {
    const { container } = renderIntl(
      <BulletsSection latestExperience={latestExperience} onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("shared primitives — accessibility", () => {
  it("PageHeading has no axe violations", async () => {
    const { container } = render(
      <PageHeading
        title="Search roles"
        description="Find roles across boards."
        actions={<button type="button">Action</button>}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

});
