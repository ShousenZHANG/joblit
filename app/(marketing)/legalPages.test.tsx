import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import PrivacyPolicyPage, {
  generateMetadata as generatePrivacyMetadata,
} from "./privacy/page";
import TermsOfServicePage, {
  generateMetadata as generateTermsMetadata,
} from "./terms/page";

const localeState = vi.hoisted(() => ({
  messages: {} as Record<string, Record<string, string>>,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve(
      (key: string) => localeState.messages[namespace]?.[key] ?? `${namespace}.${key}`,
    ),
}));

afterEach(cleanup);

beforeEach(() => {
  localeState.messages = en as unknown as Record<string, Record<string, string>>;
});

describe("legal page navigation", () => {
  it.each([
    ["privacy", PrivacyPolicyPage],
    ["terms", TermsOfServicePage],
  ])("keeps %s navigation touchable and keyboard visible", async (_name, Page) => {
    const { container } = render(await Page());
    const nav = container.querySelector("nav.mb-6");
    const main = container.querySelector("#main-content");

    expect(nav).not.toBeNull();
    expect(main).toHaveAttribute("tabindex", "-1");
    const home = within(nav as HTMLElement).getByRole("link", { name: "Joblit" });
    const back = within(nav as HTMLElement).getByRole("link", { name: "Back" });

    for (const link of [home, back]) {
      expect(link).toHaveClass("min-h-11");
      expect(link.className).toContain("focus-visible:ring-2");
    }
  });

  it("localizes the privacy chrome, table of contents, cross-link, and footer", async () => {
    localeState.messages = zh as unknown as Record<string, Record<string, string>>;
    const { container } = render(await PrivacyPolicyPage());
    const topNav = container.querySelector("nav.mb-6");
    const footer = container.querySelector("footer");

    expect(within(topNav as HTMLElement).getByRole("link", { name: "返回" })).toBeInTheDocument();
    expect(within(container).getByRole("button", { name: "目录" })).toBeInTheDocument();
    expect(
      within(container).getByText(
        "另请参阅《服务条款》，了解使用 Joblit 时应遵守的规则。",
      ),
    ).toBeInTheDocument();
    expect(
      within(footer as HTMLElement).getByRole("link", { name: zh.marketing.terms }),
    ).toHaveAttribute("href", "/terms");
  });

  it("localizes legal page metadata", async () => {
    localeState.messages = zh as unknown as Record<string, Record<string, string>>;

    expect((await generatePrivacyMetadata()).title).toBe(zh.privacy.title);
    expect((await generateTermsMetadata()).title).toBe(zh.terms.title);
  });
});
