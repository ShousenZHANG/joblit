import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import messages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";
import ExtensionGuidePage from "./page";

const localeState = vi.hoisted(() => ({
  messages: {} as Record<string, Record<string, string>>,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (ns: string) => {
    return Promise.resolve((key: string) => {
      return localeState.messages[ns]?.[key] ?? `${ns}.${key}`;
    });
  },
}));

afterEach(cleanup);

beforeEach(() => {
  localeState.messages = messages as unknown as Record<string, Record<string, string>>;
});

async function renderPage(localeMessages = messages) {
  localeState.messages = localeMessages as unknown as Record<string, Record<string, string>>;
  const Page = await ExtensionGuidePage();
  return render(Page);
}

describe("ExtensionGuidePage", () => {
  it("renders the page title", async () => {
    await renderPage();
    expect(
      screen.getByText("Joblit AutoFill — Chrome Extension"),
    ).toBeInTheDocument();
  });

  it("renders all 5 installation steps", async () => {
    await renderPage();
    expect(screen.getByText(messages.extensionGuide.downloadTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.installTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.accountTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.tokenTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.connectTitle)).toBeInTheDocument();
  });

  it("renders the usage methods section", async () => {
    await renderPage();
    expect(screen.getByText(messages.extensionGuide.useTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.useMethod1Title)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.useMethod2Title)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.useMethod3Title)).toBeInTheDocument();
  });

  it("renders supported ATS platforms", async () => {
    await renderPage();
    expect(screen.getByText("Greenhouse")).toBeInTheDocument();
    expect(screen.getByText("Lever")).toBeInTheDocument();
    expect(screen.getByText("Workday")).toBeInTheDocument();
    expect(screen.getByText("iCIMS")).toBeInTheDocument();
    expect(screen.getByText("SuccessFactors")).toBeInTheDocument();
  });

  it("renders FAQ section with expandable items", async () => {
    await renderPage();
    expect(screen.getByText(messages.extensionGuide.faq1Q)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.faq2Q)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.faq3Q)).toBeInTheDocument();
    expect(screen.getByText(messages.extensionGuide.faq4Q)).toBeInTheDocument();
  });

  it("includes download link to GitHub releases", async () => {
    await renderPage();
    const downloadLink = screen.getByRole("link", {
      name: new RegExp(messages.extensionGuide.downloadBtn),
    });
    expect(downloadLink).toHaveAttribute(
      "href",
      "https://github.com/ShousenZHANG/joblit/releases/latest",
    );
    expect(downloadLink).toHaveAttribute("target", "_blank");
  });

  it("includes navigation links", async () => {
    await renderPage();
    const backLink = screen.getByText(messages.extensionGuide.backToHome);
    expect(backLink.closest("a")).toHaveAttribute("href", "/");
  });

  it("provides a skip-link target, 44px controls, and visible focus styles", async () => {
    const { container } = await renderPage();
    expect(container.querySelector("main")).toHaveClass("extension-guide-surface");
    const skipTarget = container.querySelector("#main-content");
    expect(skipTarget).toBeInTheDocument();
    expect(skipTarget).toHaveAttribute("tabindex", "-1");

    const downloadLink = screen.getByRole("link", {
      name: new RegExp(messages.extensionGuide.downloadBtn),
    });
    const backLink = screen.getByRole("link", {
      name: new RegExp(messages.extensionGuide.backToHome),
    });
    const firstFaq = screen.getByText(messages.extensionGuide.faq1Q).closest("summary");

    expect(downloadLink).toHaveClass("min-h-11");
    expect(backLink).toHaveClass("min-h-11");
    expect(firstFaq).toHaveClass("min-h-11");
    expect(downloadLink?.className).toContain("focus-visible:ring-2");
    expect(firstFaq?.className).toContain("focus-visible:ring-2");
  });

  it("localizes instructional and footer labels in Chinese", async () => {
    await renderPage(zhMessages);

    expect(screen.getByText(`${zhMessages.extensionGuide.tipLabel}:`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: zhMessages.marketing.privacy })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: zhMessages.marketing.terms })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByText(zhMessages.extensionGuide.genericForms)).toBeInTheDocument();
    expect(screen.getByText(zhMessages.extensionGuide.genericFormsDomain)).toBeInTheDocument();
  });

  it("has no automated accessibility violations", async () => {
    const { container } = await renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
