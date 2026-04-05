import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import messages from "../../../messages/en.json";
import ExtensionGuidePage from "./page";

vi.mock("next-intl/server", () => ({
  getTranslations: (ns: string) => {
    return Promise.resolve((key: string) => {
      const map = messages as Record<string, Record<string, string>>;
      return map[ns]?.[key] ?? `${ns}.${key}`;
    });
  },
}));

afterEach(cleanup);

async function renderPage() {
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
});
