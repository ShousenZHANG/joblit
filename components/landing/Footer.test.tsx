import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import zh from "../../messages/zh.json";
import { Footer } from "./Footer";

describe("landing Footer", () => {
  it("localizes the issue link and keeps links touchable, focus-visible, and safe", () => {
    render(
      <NextIntlClientProvider locale="zh" messages={zh}>
        <Footer />
      </NextIntlClientProvider>,
    );

    const issue = screen.getByRole("link", {
      name: zh.landing.footer.resources.reportIssue,
    });
    expect(issue).toHaveClass("inline-flex", "min-h-11", "items-center");
    expect(issue.className).toContain("focus-visible:ring-2");
    expect(issue).toHaveAttribute("target", "_blank");
    expect(issue).toHaveAttribute("rel", "noopener noreferrer");

    const home = screen.getByRole("link", { name: zh.landing.nav.home });
    expect(home).toHaveClass("min-h-11");
    expect(home.className).toContain("focus-visible:ring-2");
  });
});
