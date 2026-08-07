import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import en from "../../messages/en.json";
import { LogoBar } from "./LogoBar";

function renderLogoBar() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <LogoBar />
    </NextIntlClientProvider>,
  );
}

describe("landing LogoBar", () => {
  it("shows named, auditable capability facts with no counters", () => {
    renderLogoBar();

    expect(
      screen.getByRole("heading", { level: 2, name: en.landing.logoBar.heading }),
    ).toBeInTheDocument();
    // Names, not numbers: numbers age into lies; these values are verifiable
    // against the source registry and ADR-0015.
    expect(screen.getByText("Greenhouse · Lever · Ashby · Workable")).toBeInTheDocument();
    expect(screen.getByText("Your own AI — on your machine")).toBeInTheDocument();
    expect(screen.queryByText(/gemini/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderLogoBar();
    expect(await axe(container)).toHaveNoViolations();
  });
});
