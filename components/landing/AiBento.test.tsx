import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
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
  it("shows the four AI capabilities as product miniatures", () => {
    renderBento();

    expect(screen.getByTestId("landing-bento")).toBeInTheDocument();
    for (const title of [
      en.landing.bento.requirementsTitle,
      en.landing.bento.deltaTitle,
      en.landing.bento.localTitle,
      en.landing.bento.receiptsTitle,
    ]) {
      expect(
        screen.getByRole("heading", { level: 3, name: title }),
      ).toBeInTheDocument();
    }

    // The local-first cell shows the actual Runner invocation, not a mock
    // shell aesthetic — the command must stay real (tools/runner/cli.mjs).
    expect(
      screen.getByText(/node tools\/runner\/cli\.mjs --watch/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/gemini/i)).not.toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = renderBento();
    expect(await axe(container)).toHaveNoViolations();
  });
});
