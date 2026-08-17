import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import en from "../../messages/en.json";
import { AiBento } from "./AiBento";

function renderBento() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AiBento />
    </NextIntlClientProvider>,
  );
}

describe("landing AiBento", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the four AI capabilities as product miniatures", () => {
    renderBento();

    expect(screen.getByTestId("landing-bento")).toBeInTheDocument();
    for (const title of [
      en.landing.bento.requirementsTitle,
      en.landing.bento.summaryTitle,
      en.landing.bento.indexTitle,
      en.landing.bento.proofTitle,
    ]) {
      expect(
        screen.getByRole("heading", { level: 3, name: title }),
      ).toBeInTheDocument();
    }
  });

  it("draws the three summary gates from summaryLint (ADR-0023)", () => {
    renderBento();

    // The gate rows mirror the real checks at the import boundary: the role
    // is named, every number is grounded, every skill is grounded. A fourth
    // row appearing here means marketing invented a check the code lacks.
    expect(
      screen.getByText(en.landing.bento.summaryCheckRole),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en.landing.bento.summaryCheckNumbers),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en.landing.bento.summaryCheckSkills),
    ).toBeInTheDocument();
  });

  it("shows the index-reference skills contract, positions not names", () => {
    renderBento();

    // The snippet is the real output shape: the model returns integer
    // positions into the user's own skill bank and can never write a skill
    // name (ADR-0023).
    expect(
      screen.getByText('{ "group": 1, "items": [2, 0] }'),
    ).toBeInTheDocument();
    expect(screen.getByText(en.landing.bento.indexCaption)).toBeInTheDocument();
  });

  it("links the proof cell to the public repository", () => {
    renderBento();

    const repo = screen.getByRole("link", {
      name: en.landing.bento.proofOpenSource,
    });
    expect(repo).toHaveAttribute(
      "href",
      "https://github.com/ShousenZHANG/joblit",
    );
    expect(repo).toHaveAttribute("target", "_blank");
  });

  it("never resurrects the retired Runner or the batch receipts", () => {
    renderBento();

    // The local Runner and the receipt ledger were deleted (ADR-0022). Their
    // artifacts reappearing here means the page drifted from the runtime.
    expect(screen.queryByText(/tools\/runner/)).not.toBeInTheDocument();
    expect(screen.queryByText(/runs twice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/gemini/i)).not.toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderBento();
    expect(await axe(container)).toHaveNoViolations();
  });
});
