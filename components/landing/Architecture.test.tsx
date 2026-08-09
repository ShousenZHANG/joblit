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
  it("draws the local-first pipeline through the Codex CLI", () => {
    renderArchitecture();

    expect(screen.getByTestId("landing-architecture")).toBeInTheDocument();
    expect(screen.getByText("Runner")).toBeInTheDocument();
    // Twice by design: the node inside the boundary and the credit link.
    expect(screen.getAllByText("Codex CLI")).toHaveLength(2);
    // The engine this section used to draw was retired by ADR-0018. Its name
    // reappearing here means marketing has drifted from the runtime again.
    expect(screen.queryByText(/hermes/i)).not.toBeInTheDocument();

    // The boundary claim is the section's whole point: model calls and the
    // user's AI credential stay inside their machine (ADR-0015). It must not
    // drift into the false claim that resumes never leave the browser —
    // profile data lives in the workspace by design.
    expect(
      screen.getByText(en.landing.architecture.boundaryNote),
    ).toBeInTheDocument();

    const codexLink = screen.getByRole("link", { name: "Codex CLI" });
    expect(codexLink).toHaveAttribute(
      "href",
      "https://github.com/openai/codex",
    );
    expect(codexLink).toHaveAttribute("target", "_blank");

    // One real vector, nominative use only. Claude was removed when the
    // Runner path was pinned to Codex: a mark for an engine the Runner
    // cannot drive is a false claim, however real the logo itself is.
    expect(screen.getByRole("img", { name: "OpenAI" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Claude" })).not.toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderArchitecture();
    expect(await axe(container)).toHaveNoViolations();
  });
});
