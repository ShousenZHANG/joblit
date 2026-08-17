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
  it("draws the paste loop with the chatbot as the only boundary node", () => {
    renderArchitecture();

    expect(screen.getByTestId("landing-architecture")).toBeInTheDocument();

    // Four stages, in loop order: the workspace builds the prompt, the
    // visitor's own chatbot writes, deterministic gates check the result,
    // Finalize renders the one PDF (ADR-0015/0022/0023).
    for (const title of [
      en.landing.architecture.workspaceTitle,
      en.landing.architecture.chatbotTitle,
      en.landing.architecture.gatesTitle,
      en.landing.architecture.pdfTitle,
    ]) {
      expect(
        screen.getByRole("heading", { level: 3, name: title }),
      ).toBeInTheDocument();
    }

    // The boundary claim is the section's whole point: the chatbot node is
    // the one piece Joblit cannot see. It must not drift into the false
    // claim that resumes never leave the browser — profile data lives in
    // the workspace by design.
    expect(
      screen.getByText(en.landing.architecture.boundaryCaption),
    ).toBeInTheDocument();

    // The chatbot node names real paste targets, not an engine Joblit
    // drives: any assistant the visitor already pays for.
    expect(
      screen.getByText(en.landing.architecture.chatbotDesc),
    ).toBeInTheDocument();

    // The Runner → Codex pipeline was retired by ADR-0022. Its vocabulary —
    // or the OpenAI mark that credited it — reappearing here means marketing
    // has drifted from the runtime again.
    expect(screen.queryByText(/runner/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/codex/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "OpenAI" })).not.toBeInTheDocument();

    // A nav anchor points here; the section must carry the matching id.
    expect(screen.getByTestId("landing-architecture")).toHaveAttribute(
      "id",
      "architecture",
    );
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderArchitecture();
    expect(await axe(container)).toHaveNoViolations();
  });
});
