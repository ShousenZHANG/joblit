import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import en from "../../messages/en.json";
import { Faq } from "./Faq";

function renderFaq() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Faq />
    </NextIntlClientProvider>,
  );
}

describe("landing Faq", () => {
  it("answers exactly the three real objections", () => {
    renderFaq();

    expect(screen.getByTestId("landing-faq")).toBeInTheDocument();
    for (const key of ["free", "privacy", "byoai"] as const) {
      expect(
        screen.getByText(en.landing.faq.items[key].q),
      ).toBeInTheDocument();
    }

    // The privacy answer must state the architectural guarantee, not a
    // policy promise: servers hold no model key (ADR-0015).
    expect(
      screen.getByText(/servers hold no model key/i),
    ).toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderFaq();
    expect(await axe(container)).toHaveNoViolations();
  });
});
