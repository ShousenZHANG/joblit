import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import AppLayout from "./layout";

const localeState = vi.hoisted(() => ({
  messages: {} as Record<string, Record<string, string>>,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve(
      (key: string) => localeState.messages[namespace]?.[key] ?? `${namespace}.${key}`,
    ),
}));

vi.mock("@/components/app-shell/AppNav", () => ({
  AppNav: () => <nav aria-label="Application" />,
}));

vi.mock("@/components/app-shell/CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/components/landing/Starfield", () => ({
  Starfield: () => null,
}));

vi.mock("../GuideContext", () => ({
  GuideProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../RouteTransition", () => ({
  RouteTransition: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="route-transition">{children}</div>
  ),
}));

async function renderLayout(messages = en) {
  localeState.messages = messages as unknown as Record<string, Record<string, string>>;
  return render(await AppLayout({ children: <div>Workspace</div> }));
}

describe("AppLayout", () => {
  beforeEach(() => {
    localeState.messages = en as unknown as Record<string, Record<string, string>>;
  });

  afterEach(cleanup);

  it("puts a skip link before navigation and wraps routes in a focusable main landmark", async () => {
    await renderLayout();

    const skipLink = screen.getByRole("link", { name: "Skip to content" });
    const navigation = screen.getByRole("navigation", { name: "Application" });
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(
      Boolean(skipLink.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveClass("flex", "min-h-0", "flex-1", "flex-col", "outline-none");
    expect(within(main).getByTestId("route-transition")).toHaveTextContent("Workspace");
  });

  it("localizes the skip link in Chinese", async () => {
    await renderLayout(zh);

    expect(screen.getByRole("link", { name: "跳到正文" })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });
});
