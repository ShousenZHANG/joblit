import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import { Access } from "./Access";

describe("landing Access", () => {
  it("keeps the mobile email field at the 44px interaction height", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Access />
      </NextIntlClientProvider>,
    );

    const email = screen.getByRole("textbox", {
      name: en.landing.access.emailLabel,
    });

    expect(email).toHaveClass("h-11", "w-full", "sm:flex-1");
    expect(email).not.toHaveClass("flex-1");
  });
});
