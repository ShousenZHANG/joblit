import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import en from "../../messages/en.json";
import { Architecture } from "./Architecture";

function renderArchitecture() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Architecture />
    </NextIntlClientProvider>,
  );
}

describe("landing Architecture", () => {
  it("draws the local-first pipeline and names Hermes with a source link", () => {
    renderArchitecture();

    expect(screen.getByTestId("landing-architecture")).toBeInTheDocument();
    expect(screen.getByText("Runner")).toBeInTheDocument();
    // Twice by design: the chip inside the boundary and the credit link.
    expect(screen.getAllByText("Hermes")).toHaveLength(2);

    // The boundary claim is the section's whole point: model calls and the
    // user's AI credential stay inside their machine (ADR-0015). It must not
    // drift into the false claim that resumes never leave the browser —
    // profile data lives in the workspace by design.
    expect(
      screen.getByText(en.landing.architecture.boundaryNote),
    ).toBeInTheDocument();

    const hermesLink = screen.getByRole("link", { name: "Hermes" });
    expect(hermesLink).toHaveAttribute(
      "href",
      "https://github.com/NousResearch/hermes-agent",
    );
    expect(hermesLink).toHaveAttribute("target", "_blank");

    // "Works with" marks: real vectors for OpenAI and Claude; Hermes stays a
    // wordmark because no clean official vector exists — never invent one.
    expect(screen.getByRole("img", { name: "OpenAI" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByText("ChatGPT")).toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderArchitecture();
    expect(await axe(container)).toHaveNoViolations();
  });
});
