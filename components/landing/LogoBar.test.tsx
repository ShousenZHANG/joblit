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
  it("exposes a real heading and final numeric values before animation starts", () => {
    renderLogoBar();

    expect(screen.getByRole("heading", { level: 2, name: en.landing.logoBar.heading })).toBeInTheDocument();
    expect(screen.getByText("8")).toHaveClass("sr-only");
    expect(screen.getByText("5")).toHaveClass("sr-only");
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderLogoBar();
    expect(await axe(container)).toHaveNoViolations();
  });
});
